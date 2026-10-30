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

/** GET /api/characters/[id]/like — { liked, likeCount } (비로그인은 liked:false) */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const characterId = await parseId(ctx);
  if (!characterId) return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });

  const rows = await query<{ like_count: number }>(
    "SELECT like_count FROM characters WHERE id = ? AND is_active = 1",
    [characterId]
  );
  if (rows.length === 0) return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });

  const userId = await getUserId();
  let liked = false;
  if (userId) {
    const l = await query(
      "SELECT 1 FROM character_likes WHERE user_id = ? AND character_id = ? LIMIT 1",
      [userId, characterId]
    );
    liked = l.length > 0;
  }
  return NextResponse.json({ liked, likeCount: Number(rows[0].like_count) });
}

/** POST /api/characters/[id]/like — 좋아요 토글 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const characterId = await parseId(ctx);
  if (!characterId) return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [chars] = await conn.query("SELECT id FROM characters WHERE id = ? AND is_active = 1 FOR UPDATE", [characterId]);
    if ((chars as unknown[]).length === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
    }

    const [delRes] = await conn.query("DELETE FROM character_likes WHERE user_id = ? AND character_id = ?", [
      userId,
      characterId,
    ]);
    let liked: boolean;
    if ((delRes as { affectedRows: number }).affectedRows > 0) {
      liked = false;
      await conn.query("UPDATE characters SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?", [characterId]);
    } else {
      liked = true;
      await conn.query("INSERT INTO character_likes (user_id, character_id) VALUES (?, ?)", [userId, characterId]);
      await conn.query("UPDATE characters SET like_count = like_count + 1 WHERE id = ?", [characterId]);
    }
    const [cnt] = await conn.query("SELECT like_count FROM characters WHERE id = ?", [characterId]);
    await conn.commit();

    await invalidateCachePattern("cache:web:chars:*");
    return NextResponse.json({ liked, likeCount: Number((cnt as { like_count: number }[])[0].like_count) });
  } catch (e) {
    await conn.rollback().catch(() => {});
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    conn.release();
  }
}
