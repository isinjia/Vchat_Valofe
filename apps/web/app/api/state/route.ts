import { NextRequest, NextResponse } from "next/server";
import { getUserCharacterState } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

/** GET /api/state?characterId= — 현재 호감도 (비로그인 401) */
export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const characterId = Number(req.nextUrl.searchParams.get("characterId"));
  if (!characterId) return NextResponse.json({ error: "characterId 가 필요합니다." }, { status: 400 });
  const state = await getUserCharacterState(userId, characterId);
  return NextResponse.json({ affinity: state.affinity, messageCount: state.message_count });
}
