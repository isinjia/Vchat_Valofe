import { NextRequest, NextResponse } from "next/server";
import { query, execute, parseAnniversaryInput } from "@vchatbot/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await query("SELECT * FROM anniversary_presets ORDER BY month, day, id");
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const parsed = parseAnniversaryInput(await req.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { name, month, day, notice_days, duration_days, description } = parsed.value;
  const result = await execute(
    "INSERT INTO anniversary_presets (name, month, day, notice_days, duration_days, description) VALUES (?, ?, ?, ?, ?, ?)",
    [name, month, day, notice_days, duration_days, description]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
