"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { studioFetch, jsonInit } from "../../studio-api";

export default function NewWorldPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || busy) return;
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
        <button onClick={create} disabled={busy || !name.trim()}>{busy ? "생성 중..." : "만들기"}</button>
      </div>
    </div>
  );
}
