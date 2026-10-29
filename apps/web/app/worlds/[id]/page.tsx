import Link from "next/link";
import { query, type CharacterPersona, type World } from "@vchatbot/core";

export const dynamic = "force-dynamic";

export default async function CharacterSelectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const worlds = await query<World>("SELECT * FROM worlds WHERE id = ? AND is_active = 1", [id]);
  if (worlds.length === 0) {
    return (
      <div className="container">
        <p className="empty">세계관을 찾을 수 없습니다.</p>
      </div>
    );
  }
  const world = worlds[0];

  const characters = await query<CharacterPersona & { thumb: string | null }>(
    `SELECT c.*,
            (SELECT url FROM illustrations i
             WHERE i.character_id = c.id AND i.kind = 'basic'
             ORDER BY i.sort_order, i.id LIMIT 1) AS thumb
     FROM characters c
     WHERE c.world_id = ? AND c.is_active = 1
     ORDER BY c.id`,
    [id]
  );

  return (
    <div className="container">
      <p style={{ marginBottom: 12 }}>
        <Link href="/" style={{ color: "var(--muted)" }}>← 세계 선택으로</Link>
      </p>
      <h1 className="page-title">{world.name}</h1>
      <p className="page-sub">{world.description.slice(0, 200)}</p>
      <div className="card-grid">
        {characters.map((c) => (
          <Link key={c.id} href={`/chat/${c.id}`} className="card">
            {c.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.thumb} alt={c.name} className="char-thumb" />
            ) : (
              <div className="char-thumb" />
            )}
            <h3>{c.name}</h3>
            <p>{c.profile.slice(0, 80)}</p>
          </Link>
        ))}
        {characters.length === 0 && (
          <p className="empty">이 세계에는 아직 캐릭터가 없습니다.</p>
        )}
      </div>
    </div>
  );
}
