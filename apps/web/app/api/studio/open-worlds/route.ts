import { NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { requireUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

/** GET: 공개(open)+활성 세계관 전체 — 캐릭터 만들 때 선택지 (로그인 필수) */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const rows = await query(
    `SELECT w.id, w.name, w.title_image_url, w.title_color, w.open_scope, w.owner_user_id, u.nickname AS owner_nickname
     FROM worlds w LEFT JOIN users u ON u.id = w.owner_user_id
     WHERE w.visibility = 'open' AND w.status = 'active'
     ORDER BY w.id DESC`
  );
  return NextResponse.json(rows);
}
