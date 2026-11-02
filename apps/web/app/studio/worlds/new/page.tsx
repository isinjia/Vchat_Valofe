"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { studioFetch, jsonInit } from "../../studio-api";

export default function NewWorldPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  // 400ms 디바운스로 세계관 이름 중복 확인
  useEffect(() => {
    setAvailable(null);
    const n = name.trim();
    if (!n) return;
    let alive = true;
    const t = setTimeout(() => {
      studioFetch(`/api/studio/worlds/check-name?name=${encodeURIComponent(n)}`)
        .then((r) => r.json())
        .then((d) => alive && setAvailable(d.available !== false))
        .catch(() => {});
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [name]);

  const create = async () => {
    if (!name.trim() || busy || available === false) return;
    setBusy(true);
    const res = await studioFetch("/api/studio/worlds", jsonInit("POST", { name }));
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      alert(`생성 실패: ${r.error ?? res.statusText}`);
      return;
    }
    router.replace(`/studio/worlds/${r.id}`);
  };

  return (
    <div className="container studio">
      <h2 className="page-title">
        <Link href="/studio" className="back-link" title="스튜디오로">‹</Link> 새 세계관
      </h2>
      <div className="panel">
        <label>세계관 이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        {available === true && <div className="muted ok-text">✓ 사용 가능</div>}
        {available === false && <div className="muted err-text">✗ 이미 존재하는 세계관 이름입니다</div>}
        <button onClick={create} disabled={busy || !name.trim() || available === false}>{busy ? "생성 중..." : "만들기"}</button>
      </div>
    </div>
  );
}
