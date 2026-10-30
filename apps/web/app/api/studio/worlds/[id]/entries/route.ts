import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { requireUser, canUseWorld, bad } from "@/lib/studio";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * 세계관 공통 사전 항목(인물·지역·용어) 목록 — 캐릭터 관계/기억 대상 선택용 (읽기 전용).
 * 내 세계관이 아니어도 open+active 세계관이면 허용 (canUseWorld 재사용).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  if (!(await canUseWorld(id, auth.userId))) return bad("사용할 수 없는 세계관입니다.", 403);
  const rows = await query(
    `SELECT id, title, category, content, linked_character_id
     FROM world_dictionary
     WHERE world_id = ? AND character_id IS NULL
     ORDER BY category, sort_order, id`,
    [Number(id)]
  );
  return NextResponse.json(rows);
}
