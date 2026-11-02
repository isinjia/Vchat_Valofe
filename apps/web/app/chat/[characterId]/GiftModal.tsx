"use client";

import { useEffect, useState } from "react";
import CoinIcon from "../../components/CoinIcon";

/** 선물하기 모달: 세계관 아이템 목록 + 내 사용 상태(쿨다운/횟수) → 사용 시 코인 차감·호감도 효과 */

export interface GiftUseResult {
  balance: number;
  affinityDelta: number;
  item: { id: number; name: string; image_url: string | null };
}

interface GiftItem {
  id: number;
  name: string;
  description: string | null;
  icon_url: string | null;
  image_url: string | null;
  price: number;
  reset_affinity: boolean;
  cooldown_hours: number;
  maxUses: number;
  usedCount: number;
  remaining: number | null;
  nextAvailableAt: string | null;
}

export default function GiftModal({
  open,
  characterId,
  characterName,
  onClose,
  onUsed,
}: {
  open: boolean;
  characterId: number;
  characterName: string;
  onClose: () => void;
  onUsed: (r: GiftUseResult) => void;
}) {
  const [items, setItems] = useState<GiftItem[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setError("");
    fetch(`/api/chat/gifts?characterId=${characterId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        setItems(Array.isArray(d.items) ? d.items : []);
        if (typeof d.balance === "number") setBalance(d.balance);
      })
      .catch(() => setError("아이템 목록을 불러올 수 없습니다."));
  }, [open, characterId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busyId == null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busyId, onClose]);

  if (!open) return null;

  const use = async (it: GiftItem) => {
    if (busyId != null) return;
    if (!confirm(`'${it.name}' 을(를) ${it.price.toLocaleString()}코인에 선물할까요?`)) return;
    setBusyId(it.id);
    setError("");
    try {
      const res = await fetch("/api/chat/gift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId, itemId: it.id }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error ?? res.statusText);
      onUsed({ balance: r.balance, affinityDelta: r.affinityDelta, item: r.item });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const stateLabel = (it: GiftItem): { text: string; blocked: boolean } => {
    if (it.remaining === 0) return { text: "횟수 소진", blocked: true };
    if (it.nextAvailableAt) {
      return { text: `쿨다운 — ${new Date(it.nextAvailableAt).toLocaleString("ko-KR")} 이후`, blocked: true };
    }
    if (balance != null && balance < it.price) return { text: "코인 부족", blocked: true };
    const parts: string[] = [];
    if (it.maxUses > 0 && it.remaining != null) parts.push(`남은 횟수 ${it.remaining}`);
    if (it.cooldown_hours > 0) parts.push(`텀 ${it.cooldown_hours}시간`);
    return { text: parts.join(" · "), blocked: false };
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && busyId == null) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 520 }}>
        <h3>🎁 {characterName}에게 선물하기</h3>
        {balance != null && (
          <p className="muted" style={{ fontSize: 13, margin: "2px 0 10px" }}>
            내 코인: <CoinIcon size={13} /> {balance.toLocaleString()}
          </p>
        )}

        {items === null && <p className="muted">불러오는 중...</p>}
        {items !== null && items.length === 0 && !error && (
          <p className="muted">이 세계관에 등록된 선물 아이템이 없습니다.</p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto" }}>
          {(items ?? []).map((it) => {
            const st = stateLabel(it);
            return (
              <div
                key={it.id}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  opacity: st.blocked ? 0.55 : 1,
                }}
              >
                {it.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.icon_url} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <span style={{ width: 48, height: 48, borderRadius: 8, background: "var(--panel)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
                    🎁
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b>{it.name}</b>
                    {it.reset_affinity && (
                      <span className="badge cond" title="사용 시 호감도가 0으로 초기화됩니다">호감도 초기화</span>
                    )}
                  </div>
                  {it.description && (
                    <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{it.description}</div>
                  )}
                  {st.text && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{st.text}</div>}
                </div>
                <button
                  type="button"
                  style={{ margin: 0, whiteSpace: "nowrap", flexShrink: 0 }}
                  disabled={st.blocked || busyId != null}
                  onClick={() => use(it)}
                >
                  {busyId === it.id ? "사용 중..." : <><CoinIcon size={13} /> {it.price.toLocaleString()}</>}
                </button>
              </div>
            );
          })}
        </div>

        {error && <p className="crop-err">{error}</p>}
        <div className="crop-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busyId != null}>닫기</button>
        </div>
      </div>
    </div>
  );
}
