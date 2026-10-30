"use client";

import { useEffect, useState } from "react";

interface Sanction {
  id: number;
  kind: string;
  reason: string | null;
  admin_id: number | null;
  starts_at: string;
  ends_at: string;
  revoked_at: string | null;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  chat_block: "모든 채팅 금지",
  new_chat_block: "신규 채팅 시작 금지",
  hide: "기간제 비공개",
};

const KIND_OPTIONS = {
  user: [
    { value: "chat_block", label: "모든 채팅 금지" },
    { value: "new_chat_block", label: "신규 채팅 시작 금지" },
  ],
  character: [{ value: "hide", label: "기간제 비공개" }],
} as const;

const fmtDt = (x: string) =>
  new Date(x).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function statusOf(s: Sanction): "active" | "revoked" | "expired" {
  if (s.revoked_at) return "revoked";
  return new Date(s.ends_at) > new Date() ? "active" : "expired";
}

/** 제재 적용 + 이력 패널 (유저/캐릭터 공용) */
export default function SanctionPanel({ targetType, targetId }: { targetType: "user" | "character"; targetId: string | number }) {
  const options = KIND_OPTIONS[targetType];
  const [list, setList] = useState<Sanction[]>([]);
  const [kind, setKind] = useState<string>(options[0].value);
  const [days, setDays] = useState(3);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch(`/api/sanctions?targetType=${targetType}&targetId=${targetId}`)
      .then((r) => r.json())
      .then((d) => setList(Array.isArray(d) ? d : []))
      .catch(() => {});

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, targetId]);

  const apply = async () => {
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      alert("일수는 1~365 사이의 정수여야 합니다.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/sanctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: targetType,
          target_id: Number(targetId),
          kind,
          days,
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const r = await res.json().catch(() => ({}));
        alert(r.error ?? "제재 적용 실패");
        return;
      }
      setReason("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number) => {
    if (!confirm("이 제재를 중도 해제할까요?")) return;
    const res = await fetch(`/api/sanctions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(r.error ?? "해제 실패");
    }
    load();
  };

  return (
    <div className="panel">
      <h3>제재</h3>
      <div className="row">
        {options.length > 1 ? (
          <div>
            <label>종류</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ) : null}
        <div>
          <label>일수 (1~365)</label>
          <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </div>
        <div style={{ flex: 2 }}>
          <label>사유</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="제재 사유 (선택)" />
        </div>
        <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
          <button className="danger" style={{ marginTop: 0 }} disabled={busy} onClick={apply}>
            {targetType === "character" ? "기간제 비공개 제재 적용" : "제재 적용"}
          </button>
        </div>
      </div>
      <table style={{ marginTop: 14 }}>
        <thead><tr><th>종류</th><th>기간</th><th>사유</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {list.map((s) => {
            const st = statusOf(s);
            return (
              <tr key={s.id}>
                <td>{KIND_LABEL[s.kind] ?? s.kind}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDt(s.starts_at)} ~ {fmtDt(s.ends_at)}</td>
                <td>{s.reason ?? ""}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {st === "active" ? <span style={{ color: "#e5484d" }}>제재 중</span> : st === "revoked" ? "해제됨" : "만료"}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {st === "active" && <button className="small" onClick={() => revoke(s.id)}>해제</button>}
                </td>
              </tr>
            );
          })}
          {list.length === 0 && <tr><td colSpan={5} className="muted">제재 이력이 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
