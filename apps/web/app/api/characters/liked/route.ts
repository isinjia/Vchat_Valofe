import { NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

/** GET /api/characters/liked — 내가 좋아요한 캐릭터 id 배열 (목록 캐시와 분리된 유저별 상태) */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json([]);
  const rows = await query<{ character_id: number }>(
    "SELECT character_id FROM character_likes WHERE user_id = ?",
    [userId]
  );
  return NextResponse.json(rows.map((r) => Number(r.character_id)));
}
