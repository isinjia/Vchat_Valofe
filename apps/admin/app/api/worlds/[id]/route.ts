import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query("SELECT * FROM worlds WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { name, description, ai_prompt, is_active } = await req.json();
  await execute(
    `UPDATE worlds SET name = ?, description = ?, ai_prompt = ?, is_active = ? WHERE id = ?`,
    [name, description, ai_prompt, is_active ? 1 : 0, id]
  );
  await invalidateChatContext();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await execute("DELETE FROM worlds WHERE id = ?", [id]);
  await invalidateChatContext();
  return NextResponse.json({ ok: true });
}
