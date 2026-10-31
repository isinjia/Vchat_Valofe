import { NextRequest, NextResponse } from "next/server";
import { getPool, query, invalidateCachePattern } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx): Promise<number | null> {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET /api/worlds/[id]/like — { liked, likeCount } (비로그인은 liked:false) */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const worldId = await parseId(ctx);
  if (!worldId) return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });

  const rows = await query<{ like_count: number }>(
    "SELECT like_count FROM worlds WHERE id = ? AND is_active = 1",
    [worldId]
  );
  if (rows.length === 0) return NextResponse.json({ error: "세계관을 찾을 수 없습니다." }, { status: 404 });

  const userId = await getUserId();
  let liked = false;
  if (userId) {
    const l = await query("SELECT 1 FROM world_likes WHERE user_id = ? AND world_id = ? LIMIT 1", [userId, worldId]);
    liked = l.length > 0;
  }
  return NextResponse.json({ liked, likeCount: Number(rows[0].like_count) });
}

/** POST /api/worlds/[id]/like — 좋아요 토글 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const worldId = await parseId(ctx);
  if (!worldId) return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT id FROM worlds WHERE id = ? AND is_active = 1 FOR UPDATE", [worldId]);
    if ((rows as unknown[]).length === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "세계관을 찾을 수 없습니다." }, { status: 404 });
    }

    const [delRes] = await conn.query("DELETE FROM world_likes WHERE user_id = ? AND world_id = ?", [userId, worldId]);
    let liked: boolean;
    if ((delRes as { affectedRows: number }).affectedRows > 0) {
      liked = false;
      await conn.query("UPDATE worlds SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?", [worldId]);
    } else {
      liked = true;
      await conn.query("INSERT INTO world_likes (user_id, world_id) VALUES (?, ?)", [userId, worldId]);
      await conn.query("UPDATE worlds SET like_count = like_count + 1 WHERE id = ?", [worldId]);
    }
    const [cnt] = await conn.query("SELECT like_count FROM worlds WHERE id = ?", [worldId]);
    await conn.commit();

    // 메인 세계 목록은 좋아요 순 정렬이라 캐시 무효화
    await invalidateCachePattern("cache:web:worlds*");
    return NextResponse.json({ liked, likeCount: Number((cnt as { like_count: number }[])[0].like_count) });
  } catch (e) {
    await conn.rollback().catch(() => {});
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    conn.release();
  }
}
