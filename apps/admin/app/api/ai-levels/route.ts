import { NextRequest, NextResponse } from "next/server";
import { query, execute, type AiLevel, type AiLevelLlmAssignment } from "@vchatbot/core";

export async function GET() {
  const levels = await query<AiLevel>("SELECT * FROM ai_levels ORDER BY level");
  const assignments = await query<AiLevelLlmAssignment>(
    `SELECT a.id, a.ai_level_id, a.llm_provider_id, a.weight,
            p.name AS llm_name, p.is_active AS llm_is_active
     FROM ai_level_llm_assignments a
     JOIN llm_providers p ON p.id = a.llm_provider_id
     ORDER BY a.id`
  );
  return NextResponse.json(
    levels.map((l) => ({ ...l, assignments: assignments.filter((a) => a.ai_level_id === l.id) }))
  );
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const { name, description = "", kind } = b;
  const level = Number(b.level);
  if (!name) return NextResponse.json({ error: "name 은 필수입니다." }, { status: 400 });
  if (!Number.isInteger(level) || level < 0) {
    return NextResponse.json({ error: "레벨 번호는 0 이상의 정수여야 합니다." }, { status: 400 });
  }
  if (kind !== "browser" && kind !== "server") {
    return NextResponse.json({ error: "kind 는 browser/server 만 가능합니다." }, { status: 400 });
  }
  const chatCost = Math.max(0, Math.floor(Number(b.chat_cost) || 0));
  try {
    const result = await execute(
      "INSERT INTO ai_levels (level, name, description, kind, chat_cost) VALUES (?, ?, ?, ?, ?)",
      [level, name, description || null, kind, chatCost]
    );
    return NextResponse.json({ id: result.insertId }, { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "이미 있는 레벨 번호입니다." }, { status: 400 });
    }
    throw e;
  }
}
