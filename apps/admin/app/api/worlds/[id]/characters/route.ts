import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** GET: 이 세계관에 속한 캐릭터 목록 (AI 생성 참조 이미지 선택용 — 타이틀 이미지 있는 것만, 관리자는 전부) */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query(
    `SELECT id, name, title_image_url AS url
     FROM characters
     WHERE world_id = ? AND title_image_url IS NOT NULL
     ORDER BY id`,
    [Number(id)]
  );
  return NextResponse.json(rows);
}
