import { NextRequest, NextResponse } from "next/server";
import { loadRecentMessages } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

/** GET /api/history?characterId=1 — 최근 대화 이력 */
export async function GET(req: NextRequest) {
  const characterId = Number(req.nextUrl.searchParams.get("characterId"));
  if (!characterId) {
    return NextResponse.json({ error: "characterId 가 필요합니다." }, { status: 400 });
  }
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });

  const messages = await loadRecentMessages(userId, characterId, 100);
  return NextResponse.json(
    messages.map((m) => ({
      role: m.role,
      content: m.content,
      guestName: typeof m.meta?.guest === "string" ? m.meta.guest : null,
      illustrationId: m.illustrationId ?? null,
      createdAt: m.createdAt,
    }))
  );
}
