import Link from "next/link";
import { query, type World } from "@vchatbot/core";

export const dynamic = "force-dynamic";

export default async function WorldSelectPage() {
  const worlds = await query<World & { character_count: number }>(
    `SELECT w.*,
            (SELECT COUNT(*) FROM characters c WHERE c.world_id = w.id AND c.is_active = 1) AS character_count
     FROM worlds w
     WHERE w.is_active = 1
     ORDER BY w.id`
  );

  return (
    <div className="container">
      <h1 className="page-title">세계를 선택하세요</h1>
      <p className="page-sub">각 세계관 속 캐릭터들이 당신을 기다리고 있습니다.</p>
      <div className="card-grid">
        {worlds.map((w) => (
          <Link key={w.id} href={`/worlds/${w.id}`} className="card">
            <h3>{w.name}</h3>
            <p>{w.description.slice(0, 120)}</p>
            <p style={{ marginTop: 10 }}>캐릭터 {w.character_count}명</p>
          </Link>
        ))}
        {worlds.length === 0 && (
          <p className="empty">
            아직 열린 세계가 없습니다.
            <br />
            관리자 화면(5001 포트)에서 세계관을 먼저 만들어 주세요.
          </p>
        )}
      </div>
    </div>
  );
}
