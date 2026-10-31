import { NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

/** GET /api/worlds/liked — 내가 좋아요한 세계관 id 배열 (목록 캐시와 분리된 유저별 상태) */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json([]);
  const rows = await query<{ world_id: number }>("SELECT world_id FROM world_likes WHERE user_id = ?", [userId]);
  return NextResponse.json(rows.map((r) => Number(r.world_id)));
}
