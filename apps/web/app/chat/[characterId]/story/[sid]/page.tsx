import { redirect } from "next/navigation";
import { query, resolveProfileVisuals } from "@vchatbot/core";
import { getUserId } from "@/lib/user";
import StoryPlayerClient from "./player-client";

export const dynamic = "force-dynamic";

/** 스토리 플레이어 — 접근 검증은 play API 가 다시 하므로 여기선 로그인/존재만 확인 */
export default async function StoryPlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ characterId: string; sid: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  const { characterId, sid } = await params;
  const { k } = await searchParams;

  const chars = await query<{ id: number; name: string; title_color: string | null; world_color: string | null }>(
    `SELECT c.id, c.name, c.title_color, w.title_color AS world_color
     FROM characters c LEFT JOIN worlds w ON w.id = c.world_id WHERE c.id = ?`,
    [Number(characterId)]
  );
  if (!chars[0]) return <div className="container"><p className="empty">캐릭터를 찾을 수 없습니다.</p></div>;
  const avatar = await query<{ url: string }>(
    "SELECT url FROM illustrations WHERE character_id = ? AND kind = 'basic' AND media_type = 'image' ORDER BY sort_order, id LIMIT 1",
    [Number(characterId)]
  );
  // 채팅 헤더와 동일한 프로필 아바타 (고급 프로필: 배경→얼굴→효과 겹침, 없으면 기본 일러스트)
  const profileMap = await resolveProfileVisuals(Number(characterId), userId);

  return (
    <StoryPlayerClient
      characterId={Number(characterId)}
      characterName={chars[0].name}
      storyId={Number(sid)}
      shareKey={k ?? null}
      visual={profileMap["default"] ?? null}
      avatarUrl={avatar[0]?.url ?? null}
      worldColor={chars[0].world_color}
      charColor={chars[0].title_color ?? chars[0].world_color}
    />
  );
}
