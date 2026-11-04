import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ sid: string }> };

async function parseId(ctx: Ctx): Promise<number | null> {
  const { sid } = await ctx.params;
  const n = Number(sid);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET /api/stories/[sid]/like — { liked, likeCount } (비로그인은 liked:false) */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const storyId = await parseId(ctx);
  if (!storyId) return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });

  const rows = await query<{ like_count: number }>(
    "SELECT like_count FROM character_stories WHERE id = ? AND status = 'published'",
    [storyId]
  );
  if (rows.length === 0) return NextResponse.json({ error: "스토리를 찾을 수 없습니다." }, { status: 404 });

  const userId = await getUserId();
  let liked = false;
  if (userId) {
    const l = await query("SELECT 1 FROM story_likes WHERE user_id = ? AND story_id = ? LIMIT 1", [userId, storyId]);
    liked = l.length > 0;
  }
  return NextResponse.json({ liked, likeCount: Number(rows[0].like_count) });
}

/** POST /api/stories/[sid]/like — 좋아요 토글 (character like 와 동일 구조) */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const storyId = await parseId(ctx);
  if (!storyId) return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT id FROM character_stories WHERE id = ? AND status = 'published' FOR UPDATE",
      [storyId]
    );
    if ((rows as unknown[]).length === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "스토리를 찾을 수 없습니다." }, { status: 404 });
    }

    const [delRes] = await conn.query("DELETE FROM story_likes WHERE user_id = ? AND story_id = ?", [userId, storyId]);
    let liked: boolean;
    if ((delRes as { affectedRows: number }).affectedRows > 0) {
      liked = false;
      await conn.query("UPDATE character_stories SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?", [storyId]);
    } else {
      liked = true;
      await conn.query("INSERT INTO story_likes (user_id, story_id) VALUES (?, ?)", [userId, storyId]);
      await conn.query("UPDATE character_stories SET like_count = like_count + 1 WHERE id = ?", [storyId]);
    }
    const [cnt] = await conn.query("SELECT like_count FROM character_stories WHERE id = ?", [storyId]);
    await conn.commit();
    return NextResponse.json({ liked, likeCount: Number((cnt as { like_count: number }[])[0].like_count) });
  } catch (e) {
    await conn.rollback().catch(() => {});
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    conn.release();
  }
}
