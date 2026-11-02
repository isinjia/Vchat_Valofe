import { NextRequest, NextResponse } from "next/server";
import { query, cached, sweepScheduledDeletions } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/**
 * GET /api/characters?worldId=&sort=popular|newest&offset=0&limit=20
 * 응답: { items, hasMore }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sortRaw = sp.get("sort");
  const sort =
    sortRaw === "newest"
      ? "newest"
      : sortRaw === "likes"
        ? "likes"
        : sortRaw === "chats"
          ? "chats"
          : sortRaw === "gifts"
            ? "gifts"
            : "popular";
  const offset = Number(sp.get("offset") ?? 0);
  const limit = Number(sp.get("limit") ?? 20);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) {
    return NextResponse.json({ error: "offset/limit 값이 올바르지 않습니다." }, { status: 400 });
  }
  const lim = Math.min(limit, 50);

  // 만기 지난 삭제 대기 건 정리 (lazy sweep)
  await sweepScheduledDeletions();

  const where = [
    "c.is_active = 1",
    "w.is_active = 1",
    "c.visibility = 'open'",
    "c.status = 'active'",
    "w.visibility = 'open'",
    "w.status = 'active'",
    "c.delete_scheduled_at IS NULL",
    "w.delete_scheduled_at IS NULL",
    // 운영 제재(기간제 비공개) 중인 캐릭터 제외
    `NOT EXISTS (SELECT 1 FROM sanctions s
       WHERE s.target_type = 'character' AND s.target_id = c.id AND s.kind = 'hide'
         AND s.revoked_at IS NULL AND s.ends_at > NOW())`,
  ];
  const params: (string | number)[] = [];
  const worldIdRaw = sp.get("worldId");
  if (worldIdRaw) {
    const worldId = Number(worldIdRaw);
    if (!Number.isInteger(worldId)) {
      return NextResponse.json({ error: "worldId 가 올바르지 않습니다." }, { status: 400 });
    }
    where.push("c.world_id = ?");
    params.push(worldId);
  }
  // 인기순 = 좋아요 우선(동률이면 대화 수), 대화순 = 누적 대화 수, 받은선물 = 선물 금액 합계 순
  const orderBy =
    sort === "popular"
      ? "c.like_count DESC, c.chat_count DESC, c.id DESC"
      : sort === "likes"
        ? "c.like_count DESC, c.id DESC"
        : sort === "chats"
          ? "c.chat_count DESC, c.id DESC"
          : sort === "gifts"
            ? "gift_amount DESC, c.like_count DESC, c.id DESC"
            : "c.id DESC";

  // 필터/정렬/페이지 조합별 영구 캐시 — 캐릭터/세계관 변경과 chat_count 증가 시에만 무효화
  const cacheKey = `cache:web:chars:${worldIdRaw ?? "all"}:${sort}:${offset}:${lim}`;
  const result = await cached(cacheKey, 0, async () => {
    // LIMIT/OFFSET 은 위에서 정수 검증을 마쳤으므로 문자열로 삽입 (hasMore 판정용 +1)
    const rows = await query<Record<string, unknown>>(
      `SELECT c.id, c.name, c.world_id, w.name AS world_name, COALESCE(c.title_color, w.title_color) AS title_color, c.title_image_url, c.like_count,
              uo.nickname AS owner_name,
              (SELECT COALESCE(SUM(u.price), 0) FROM item_uses u WHERE u.character_id = c.id) AS gift_amount,
              (SELECT url FROM illustrations i
               WHERE i.character_id = c.id AND i.kind = 'basic'
               ORDER BY i.sort_order, i.id LIMIT 1) AS thumb
       FROM characters c
       JOIN worlds w ON w.id = c.world_id
       LEFT JOIN users uo ON uo.id = c.owner_user_id
       WHERE ${where.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT ${lim + 1} OFFSET ${offset}`,
      params
    );
    return { items: rows.slice(0, lim), hasMore: rows.length > lim };
  });
  return NextResponse.json(result);
}
