import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

/** 캐릭터의 공개 스토리 목록 — 선택해서 플레이 */
export default async function StoryListPage({
  params,
  searchParams,
}: {
  params: Promise<{ characterId: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  const { characterId } = await params;
  const { k } = await searchParams;
  const cid = Number(characterId);

  const chars = await query<{
    id: number;
    name: string;
    owner_user_id: number | null;
    visibility: string;
    share_key: string | null;
  }>("SELECT id, name, owner_user_id, visibility, share_key FROM characters WHERE id = ?", [cid]);
  const c = chars[0];
  if (!c) return <div className="container"><p className="empty">캐릭터를 찾을 수 없습니다.</p></div>;
  if (c.visibility === "private" && c.owner_user_id !== userId && (!c.share_key || k !== c.share_key)) {
    return <div className="container"><p className="empty">비공개 캐릭터입니다.</p></div>;
  }

  const stories = await query<{ id: number; title: string; run_status: string | null; finished_count: number | null }>(
    `SELECT s.id, s.title, r.status AS run_status, r.finished_count
     FROM character_stories s
     LEFT JOIN user_story_runs r ON r.story_id = s.id AND r.user_id = ?
     WHERE s.character_id = ? AND s.status = 'published' ORDER BY s.id`,
    [userId, cid]
  );

  const kq = k ? `?k=${encodeURIComponent(k)}` : "";
  return (
    <div className="container">
      <h2 style={{ margin: "8px 0 16px" }}>
        <Link href={`/chat/${cid}${kq}`} style={{ marginRight: 8 }}>←</Link>
        {c.name} — 스토리
      </h2>
      {stories.length === 0 && <p className="empty">공개된 스토리가 없습니다.</p>}
      <div className="story-list">
        {stories.map((s) => (
          <Link key={s.id} href={`/chat/${cid}/story/${s.id}${kq}`} className="story-list-item">
            <span className="story-list-title">{s.title}</span>
            <span className="story-list-state">
              {s.run_status === "active"
                ? "진행 중 — 이어하기"
                : Number(s.finished_count ?? 0) > 0
                  ? `완료 ${s.finished_count}회 — 다시 하기`
                  : "새로 시작"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
