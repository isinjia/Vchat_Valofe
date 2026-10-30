import { NextRequest, NextResponse } from "next/server";
import { execute, parseAnniversaryInput, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = parseAnniversaryInput(await req.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { name, month, day, notice_days, duration_days, description } = parsed.value;
  await execute(
    "UPDATE world_anniversaries SET name = ?, month = ?, day = ?, notice_days = ?, duration_days = ?, description = ? WHERE id = ?",
    [name, month, day, notice_days, duration_days, description, id]
  );
  await invalidateChatContext();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await execute("DELETE FROM world_anniversaries WHERE id = ?", [id]);
  await invalidateChatContext();
  return NextResponse.json({ ok: true });
}
