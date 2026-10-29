import { NextResponse } from "next/server";
import { query, getBalance } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

/** 로그인 유저 정보 (비로그인 401) */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const rows = await query<{ nickname: string; profile_image: string | null }>(
    "SELECT nickname, profile_image FROM users WHERE id = ?",
    [userId]
  );
  if (rows.length === 0) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const coins = await getBalance(userId);
  return NextResponse.json({
    userId,
    nickname: rows[0].nickname,
    coins,
    profileImage: rows[0].profile_image,
  });
}
