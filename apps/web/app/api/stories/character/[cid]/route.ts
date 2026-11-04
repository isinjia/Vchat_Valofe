import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { getUserId, isAdultUser, ADULT_BLOCK_MESSAGE } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ cid: string }> };

/**
 * GET /api/stories/character/[cid]?k=공유키
 * 채팅창 스토리 팝업용: 캐릭터의 공개 스토리 목록 (타이틀 이미지 · 제작자 · 좋아요 · 내 진행 상태)
 */
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId();
  if (userId == null) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { cid } = await params;
  const characterId = Number(cid);
  if (!Number.isInteger(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });
  }

  const chars = await query<{
    id: number;
    owner_user_id: number | null;
    visibility: string;
    share_key: string | null;
    owner_nickname: string | null;
    char_adult: number;
  }>(
    `SELECT c.id, c.owner_user_id, c.visibility, c.share_key, u.nickname AS owner_nickname,
            (c.is_adult = 1 OR w.is_adult = 1) AS char_adult
     FROM characters c
     JOIN worlds w ON w.id = c.world_id
     LEFT JOIN users u ON u.id = c.owner_user_id WHERE c.id = ?`,
    [characterId]
  );
  const c = chars[0];
  if (!c) return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  const k = req.nextUrl.searchParams.get("k");
  if (c.visibility === "private" && c.owner_user_id !== userId && (!c.share_key || k !== c.share_key)) {
    return NextResponse.json({ error: "비공개 캐릭터입니다." }, { status: 403 });
  }
  // 19금 접근 제어: 캐릭터/세계관이 19금이면 전체 차단, 아니면 19금 스토리만 숨김
  const adultViewer = await isAdultUser(userId);
  if (Number(c.char_adult) === 1 && !adultViewer) {
    return NextResponse.json({ error: ADULT_BLOCK_MESSAGE }, { status: 403 });
  }

  const stories = await query<{
    id: number;
    title: string;
    title_image_url: string | null;
    like_count: number;
    run_status: string | null;
    finished_count: number | null;
    liked: number;
    is_adult: number;
  }>(
    `SELECT s.id, s.title, s.title_image_url, s.like_count, s.is_adult,
            r.status AS run_status, r.finished_count,
            EXISTS(SELECT 1 FROM story_likes l WHERE l.story_id = s.id AND l.user_id = ?) AS liked
     FROM character_stories s
     LEFT JOIN user_story_runs r ON r.story_id = s.id AND r.user_id = ?
     WHERE s.character_id = ? AND s.status = 'published'${adultViewer ? "" : " AND s.is_adult = 0"}
     ORDER BY s.id`,
    [userId, userId, characterId]
  );

  return NextResponse.json({
    creator: c.owner_nickname ?? "운영",
    stories: stories.map((s) => ({
      id: s.id,
      title: s.title,
      titleImageUrl: s.title_image_url,
      likeCount: Number(s.like_count),
      liked: !!Number(s.liked),
      isAdult: Number(c.char_adult) === 1 || Number(s.is_adult) === 1,
      runStatus: s.run_status,
      finishedCount: Number(s.finished_count ?? 0),
    })),
  });
}
