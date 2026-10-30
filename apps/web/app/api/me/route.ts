import { NextResponse } from "next/server";
import { query, getBalance } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

/** 로그인 유저 정보 (비로그인 401) */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const rows = await query<{
    nickname: string;
    profile_image: string | null;
    tier_name: string | null;
    tier_icon: string | null;
  }>(
    `SELECT u.nickname, u.profile_image, t.name AS tier_name, t.icon AS tier_icon
     FROM users u
     LEFT JOIN chat_tiers t
       ON t.id = COALESCE(u.tier_id, (SELECT id FROM chat_tiers WHERE is_default = 1 AND track = 'user' ORDER BY id LIMIT 1))
     WHERE u.id = ?`,
    [userId]
  );
  if (rows.length === 0) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const coins = await getBalance(userId);
  return NextResponse.json({
    userId,
    nickname: rows[0].nickname,
    coins,
    profileImage: rows[0].profile_image,
    tierName: rows[0].tier_name,
    tierIcon: rows[0].tier_icon,
  });
}
