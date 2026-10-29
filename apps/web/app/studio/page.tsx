"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import SiteHeader from "../components/SiteHeader";
import { studioFetch } from "./studio-api";

interface WorldRow {
  id: number;
  name: string;
  visibility: "private" | "open";
  character_count: number;
}
interface CharRow {
  id: number;
  name: string;
  world_name: string;
  visibility: "private" | "open";
}

function VisBadge({ v }: { v: "private" | "open" }) {
  return <span className={`badge ${v === "open" ? "open" : ""}`}>{v === "open" ? "공개" : "비공개"}</span>;
}

export default function StudioPage() {
  const [worlds, setWorlds] = useState<WorldRow[] | null>(null);
  const [chars, setChars] = useState<CharRow[] | null>(null);

  useEffect(() => {
    studioFetch("/api/studio/worlds").then((r) => r.json()).then(setWorlds).catch(() => setWorlds([]));
    studioFetch("/api/studio/characters").then((r) => r.json()).then(setChars).catch(() => setChars([]));
  }, []);

  return (
    <>
    <SiteHeader />
    <div className="container studio">
      <div className="studio-top">
        <h2 className="page-title">
          <Link href="/" style={{ color: "var(--muted)" }}>‹</Link> 스튜디오
        </h2>
      </div>
      <p className="page-sub">나만의 세계관과 캐릭터를 만들고 공개해 보세요.</p>

      <div className="studio-top">
        <h3>내 세계관</h3>
        <Link href="/studio/worlds/new"><button className="small">+ 새 세계관</button></Link>
      </div>
      <div className="panel">
        {worlds === null && <p className="muted">불러오는 중...</p>}
        {worlds?.length === 0 && <p className="muted">아직 만든 세계관이 없습니다.</p>}
        {worlds?.map((w) => (
          <div key={w.id} className="list-item">
            <div>
              {w.name} <VisBadge v={w.visibility} />
              <div className="muted">캐릭터 {w.character_count}명</div>
            </div>
            <Link href={`/studio/worlds/${w.id}`} style={{ color: "var(--accent)" }}>편집</Link>
          </div>
        ))}
      </div>

      <div className="studio-top">
        <h3>내 캐릭터</h3>
        <Link href="/studio/characters/new"><button className="small">+ 새 캐릭터</button></Link>
      </div>
      <div className="panel">
        {chars === null && <p className="muted">불러오는 중...</p>}
        {chars?.length === 0 && <p className="muted">아직 만든 캐릭터가 없습니다.</p>}
        {chars?.map((c) => (
          <div key={c.id} className="list-item">
            <div>
              {c.name} <VisBadge v={c.visibility} />
              <div className="muted">{c.world_name}</div>
            </div>
            <Link href={`/studio/characters/${c.id}`} style={{ color: "var(--accent)" }}>편집</Link>
          </div>
        ))}
      </div>
    </div>
    </>
  );
}
