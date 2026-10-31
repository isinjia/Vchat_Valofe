import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { requireUser, ownedWorld } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * GET: 이 세계관에 속한 캐릭터 목록 (AI 생성 참조 이미지 선택용 — 타이틀 이미지 있는 것만)
 * 비공개 캐릭터는 내 것만 노출한다.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;

  const rows = await query(
    `SELECT id, name, title_image_url AS url
     FROM characters
     WHERE world_id = ? AND title_image_url IS NOT NULL
       AND (visibility = 'open' OR owner_user_id = ?)
     ORDER BY id`,
    [Number(id), auth.userId]
  );
  return NextResponse.json(rows);
}
