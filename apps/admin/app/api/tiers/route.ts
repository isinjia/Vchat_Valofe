import { NextRequest, NextResponse } from "next/server";
import { query, execute, type ChatTier, type TierLlmAssignment } from "@vchatbot/core";

export async function GET() {
  const tiers = await query<ChatTier>("SELECT * FROM chat_tiers ORDER BY id");
  const assignments = await query<TierLlmAssignment>(
    `SELECT a.id, a.tier_id, a.llm_provider_id, a.weight,
            p.name AS llm_name, p.is_active AS llm_is_active
     FROM tier_llm_assignments a
     JOIN llm_providers p ON p.id = a.llm_provider_id
     ORDER BY a.id`
  );
  return NextResponse.json(
    tiers.map((t) => ({ ...t, assignments: assignments.filter((a) => a.tier_id === t.id) }))
  );
}

export async function POST(req: NextRequest) {
  const { name, description = "" } = await req.json();
  if (!name) return NextResponse.json({ error: "name 은 필수입니다." }, { status: 400 });
  const result = await execute("INSERT INTO chat_tiers (name, description) VALUES (?, ?)", [
    name,
    description || null,
  ]);
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
