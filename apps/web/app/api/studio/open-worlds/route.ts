import { NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { requireUser } from "@/lib/studio";
import { isAdultUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/** GET: 공개(open)+활성 세계관 전체 — 캐릭터 만들 때 선택지 (로그인 필수) */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  // 19금 세계관은 성인 인증된 유저에게만 선택지로 노출 (미성년·미확인 숨김)
  const adultViewer = await isAdultUser(auth.userId);
  const rows = await query(
    `SELECT w.id, w.name, w.title_image_url, w.title_color, w.open_scope, w.is_adult, w.owner_user_id, u.nickname AS owner_nickname
     FROM worlds w LEFT JOIN users u ON u.id = w.owner_user_id
     WHERE w.visibility = 'open' AND w.status = 'active'${adultViewer ? "" : " AND w.is_adult = 0"}
     ORDER BY w.id DESC`
  );
  return NextResponse.json(rows);
}
