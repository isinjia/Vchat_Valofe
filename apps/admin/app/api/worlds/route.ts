import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@vchatbot/core";

export async function GET() {
  const worlds = await query(
    `SELECT w.*, (SELECT COUNT(*) FROM characters c WHERE c.world_id = w.id) AS character_count
     FROM worlds w ORDER BY w.id DESC`
  );
  return NextResponse.json(worlds);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description = "", ai_prompt = "" } = body;
  if (!name) return NextResponse.json({ error: "name 은 필수입니다." }, { status: 400 });
  const result = await execute(
    "INSERT INTO worlds (name, description, ai_prompt) VALUES (?, ?, ?)",
    [name, description, ai_prompt]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
