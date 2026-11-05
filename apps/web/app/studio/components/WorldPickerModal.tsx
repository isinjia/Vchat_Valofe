"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { studioFetch } from "../studio-api";

/** 모달/미니카드에서 공통으로 쓰는 세계관 정보 */
export interface PickedWorld {
  id: number;
  name: string;
  title_image_url: string | null;
  title_color?: string | null;
  owner_nickname?: string | null;
  open_scope?: "all" | "dict_person";
  is_adult?: number;
  mine: boolean;
}

/** 세계관 썸네일 + 이름 + 뱃지 (미니 카드 표시용) */
export function WorldMini({ world }: { world: PickedWorld }) {
  return (
    <div className="world-mini">
      {world.title_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={world.title_image_url} alt={world.name} className="title-img" />
      ) : (
        <div className="title-img placeholder" />
      )}
      <div>
        <div className="world-picker-name">{world.name}</div>
        <span className={`badge ${world.mine ? "" : "open"}`}>{world.mine ? "내 세계관" : "공유"}</span>
        {world.is_adult === 1 && <span className="badge" style={{ marginLeft: 4 }}>🔞 19금</span>}
        {!world.mine && world.open_scope === "dict_person" && (
          <span className="badge" style={{ marginLeft: 4 }}>사전 인물만</span>
        )}
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (world: PickedWorld) => void;
}

export default function WorldPickerModal({ open, onClose, onSelect }: Props) {
  const [worlds, setWorlds] = useState<PickedWorld[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  // 열릴 때마다 내 세계관 + 오픈 세계관을 불러와 합친다 (중복은 내 것 우선)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setQ("");
    const toList = (r: Response) => r.json().then((l) => (Array.isArray(l) ? l : [])).catch(() => []);
    Promise.all([
      studioFetch("/api/studio/worlds").then(toList).catch(() => []),
      studioFetch("/api/studio/open-worlds").then(toList).catch(() => []),
    ]).then(([mineRaw, openRaw]) => {
      if (!alive) return;
      const mine: PickedWorld[] = mineRaw.map((w: PickedWorld) => ({
        id: w.id, name: w.name, title_image_url: w.title_image_url ?? null, title_color: w.title_color ?? null,
        is_adult: w.is_adult ?? 0, mine: true,
      }));
      const myIds = new Set(mine.map((w) => w.id));
      const others: PickedWorld[] = openRaw
        .filter((w: PickedWorld) => !myIds.has(w.id))
        .map((w: PickedWorld) => ({
          id: w.id, name: w.name, title_image_url: w.title_image_url ?? null, title_color: w.title_color ?? null,
          owner_nickname: w.owner_nickname ?? null, open_scope: w.open_scope ?? "all", is_adult: w.is_adult ?? 0, mine: false,
        }));
      setWorlds([...mine, ...others]);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open]);

  // Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const kw = q.trim().toLowerCase();
  const list = kw ? worlds.filter((w) => w.name.toLowerCase().includes(kw)) : worlds;
  const mineList = list.filter((w) => w.mine);
  const sharedList = list.filter((w) => !w.mine);

  const renderGrid = (items: PickedWorld[]) => (
    <div className="world-picker-grid">
      {items.map((w) => (
        <button
          type="button"
          key={w.id}
          className="world-picker-card"
          style={
            // 홈 카드와 동일하게 세계관 타이틀 컬러를 CSS 변수로 — 테두리/호버 링이 같은 색을 쓴다
            w.title_color && /^#[0-9a-fA-F]{6}$/.test(w.title_color)
              ? ({ "--world-color": w.title_color } as CSSProperties)
              : undefined
          }
          onClick={() => { onSelect(w); onClose(); }}
        >
          {w.title_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={w.title_image_url} alt={w.name} className="title-img" />
          ) : (
            <div className="title-img placeholder" />
          )}
          <div className="world-picker-name">{w.is_adult === 1 ? "🔞 " : ""}{w.name}</div>
          {!w.mine && w.owner_nickname && <div className="world-picker-owner">by {w.owner_nickname}</div>}
          {!w.mine && w.open_scope === "dict_person" && <div className="world-picker-owner">사전 인물만</div>}
        </button>
      ))}
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal world-picker-modal" onClick={(e) => e.stopPropagation()}>
        <h3>세계관 선택</h3>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="세계관 이름 검색"
        />
        {loading ? (
          <p className="muted-center">로딩 중...</p>
        ) : list.length === 0 ? (
          <p className="muted-center">표시할 세계관이 없습니다.</p>
        ) : (
          <>
            {mineList.length > 0 && (
              <>
                <div className="world-picker-section">내 세계관</div>
                {renderGrid(mineList)}
              </>
            )}
            {sharedList.length > 0 && (
              <>
                <div className="world-picker-section">공유된 세계관</div>
                {renderGrid(sharedList)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
