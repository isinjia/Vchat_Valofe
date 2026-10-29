"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { studioFetch, jsonInit } from "../../studio-api";

interface WorldOpt {
  id: number;
  name: string;
  owner_nickname?: string | null;
}

export default function NewCharacterPage() {
  const router = useRouter();
  const [mine, setMine] = useState<WorldOpt[]>([]);
  const [open, setOpen] = useState<WorldOpt[]>([]);
  const [worldId, setWorldId] = useState<number | "">("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    studioFetch("/api/studio/worlds").then((r) => r.json()).then(setMine).catch(() => {});
    studioFetch("/api/studio/open-worlds").then((r) => r.json()).then(setOpen).catch(() => {});
  }, []);

  // 내 세계관은 위 optgroup 에 있으므로 공개 목록에서는 중복 제거
  const myIds = new Set(mine.map((w) => w.id));
  const others = open.filter((w) => !myIds.has(w.id));

  const create = async () => {
    if (!worldId || !name.trim() || busy) return;
    setBusy(true);
    const res = await studioFetch("/api/studio/characters", jsonInit("POST", { world_id: worldId, name }));
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      alert(`생성 실패: ${r.error ?? res.statusText}`);
      return;
    }
    router.replace(`/studio/characters/${r.id}`);
  };

  return (
    <div className="container studio">
      <h2 className="page-title">
        <Link href="/studio" style={{ color: "var(--muted)" }}>‹</Link> 새 캐릭터
      </h2>
      <div className="panel">
        <label>세계관</label>
        <select value={worldId} onChange={(e) => setWorldId(Number(e.target.value) || "")}>
          <option value="">선택...</option>
          <optgroup label="내 세계관">
            {mine.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </optgroup>
          <optgroup label="공개된 세계관">
            {others.map((w) => (
              <option key={w.id} value={w.id}>{w.name}{w.owner_nickname ? ` (by ${w.owner_nickname})` : ""}</option>
            ))}
          </optgroup>
        </select>
        <label>캐릭터 이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <button onClick={create} disabled={busy || !worldId || !name.trim()}>{busy ? "생성 중..." : "만들기"}</button>
      </div>
    </div>
  );
}
