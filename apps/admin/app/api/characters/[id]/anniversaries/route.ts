import { NextRequest, NextResponse } from "next/server";
import { query, execute, parseAnniversaryInput, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 캐릭터 개인 기념일(그 캐릭터만 기억하는 날) 목록
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query(
    "SELECT * FROM world_anniversaries WHERE character_id = ? ORDER BY month, day, id",
    [id]
  );
  return NextResponse.json(rows);
}

// 개인 기념일 생성 (수정/삭제는 /api/anniversaries/[id] 재사용)
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const chars = await query<{ id: number; world_id: number }>("SELECT id, world_id FROM characters WHERE id = ?", [id]);
  if (chars.length === 0) return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  const parsed = parseAnniversaryInput(await req.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { name, month, day, notice_days, duration_days, description } = parsed.value;
  const result = await execute(
    "INSERT INTO world_anniversaries (world_id, character_id, preset_id, name, month, day, notice_days, duration_days, description) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)",
    [chars[0].world_id, chars[0].id, name, month, day, notice_days, description]
  );
  await invalidateChatContext(chars[0].id);
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
