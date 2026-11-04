import { NextRequest, NextResponse } from "next/server";
import { query, execute, getBalance, getBillingSettings, getPlayerPersonalityType } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

/** 로그인 유저 정보 (비로그인 401) */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const rows = await query<{
    nickname: string;
    profile_image: string | null;
    personality_type: string | null;
    tier_name: string | null;
    tier_icon: string | null;
  }>(
    `SELECT u.nickname, u.profile_image, u.personality_type, t.name AS tier_name, t.icon AS tier_icon
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
    /** 플레이어 성격 타입 key (미선택이면 null → 선택 안내) */
    personalityType: rows[0].personality_type,
    tierName: rows[0].tier_name,
    tierIcon: rows[0].tier_icon,
    /** 코인 충전 페이지 링크 (빈 값이면 충전 버튼 숨김) */
    chargeUrl: (await getBillingSettings()).chargeUrl,
  });
}

/** 내 정보 수정 — 현재는 플레이어 성격 타입만 */
export async function PUT(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const type = getPlayerPersonalityType(typeof body.personalityType === "string" ? body.personalityType : null);
  if (!type) return NextResponse.json({ error: "성격 타입이 올바르지 않습니다." }, { status: 400 });
  await execute("UPDATE users SET personality_type = ? WHERE id = ?", [type.key, userId]);
  return NextResponse.json({ ok: true, personalityType: type.key });
}
