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
  const { world_id, name, profile, personality, speech_style, ai_prompt, is_active } =
    await req.json();
  await execute(
    `UPDATE characters
     SET world_id = ?, name = ?, profile = ?, personality = ?, speech_style = ?, ai_prompt = ?, is_active = ?
     WHERE id = ?`,
    [world_id, name, profile, personality, speech_style, ai_prompt, is_active ? 1 : 0, id]
  );
  await invalidateChatContext(Number(id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await execute("DELETE FROM characters WHERE id = ?", [id]);
  await invalidateChatContext(Number(id));
  return NextResponse.json({ ok: true });
}
