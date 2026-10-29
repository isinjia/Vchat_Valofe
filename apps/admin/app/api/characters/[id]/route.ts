import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query("SELECT * FROM characters WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { world_id, name, profile, personality, speech_style, ai_prompt, scenario, greeting, is_active, visibility, status } =
    await req.json();
  // 세계관 내 캐릭터명 중복 검사
  const dup = await query("SELECT id FROM characters WHERE world_id = ? AND name = ? AND id <> ? LIMIT 1", [world_id, name, Number(id)]);
  if (dup.length > 0) return NextResponse.json({ error: "이 세계관에 같은 이름의 캐릭터가 이미 있습니다." }, { status: 400 });
  try {
  await execute(
    `UPDATE characters
     SET world_id = ?, name = ?, profile = ?, personality = ?, speech_style = ?, ai_prompt = ?, scenario = ?, greeting = ?, is_active = ?,
         visibility = ?, status = ?
     WHERE id = ?`,
    [
      world_id,
      name,
      profile,
      personality,
      speech_style,
      ai_prompt,
      scenario?.trim() ? scenario : null,
      greeting?.trim() ? greeting : null,
      is_active ? 1 : 0,
      visibility === "open" ? "open" : "private",
      status === "suspended" ? "suspended" : "active",
      id,
    ]
  );
  } catch (e) {
    // UNIQUE 제약 위반 (동시 요청 레이스 대비)
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "이 세계관에 같은 이름의 캐릭터가 이미 있습니다." }, { status: 400 });
    throw e;
  }
  await invalidateChatContext(Number(id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await execute("DELETE FROM characters WHERE id = ?", [id]);
  await invalidateChatContext(Number(id));
  return NextResponse.json({ ok: true });
}
