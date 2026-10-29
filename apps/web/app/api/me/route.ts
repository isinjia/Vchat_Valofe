import { NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { getOrCreateGuestUser } from "@/lib/user";

/** 게스트 유저 보장 + 쿠키 발급 */
export async function GET() {
  const userId = await getOrCreateGuestUser();
  const rows = await query<{ nickname: string }>("SELECT nickname FROM users WHERE id = ?", [
    userId,
  ]);
  return NextResponse.json({ userId, nickname: rows[0]?.nickname ?? "게스트" });
}
