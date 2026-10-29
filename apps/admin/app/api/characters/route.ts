import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@vchatbot/core";

export async function GET(req: NextRequest) {
  const worldId = req.nextUrl.searchParams.get("worldId");
  const sql = `
    SELECT c.*, w.name AS world_name
    FROM characters c JOIN worlds w ON w.id = c.world_id
    ${worldId ? "WHERE c.world_id = ?" : ""}
    ORDER BY c.id DESC`;
  const rows = await query(sql, worldId ? [worldId] : []);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const {
    world_id,
    name,
    profile = "",
    personality = "",
    speech_style = "",
    ai_prompt = "",
  } = await req.json();
  if (!world_id || !name) {
    return NextResponse.json({ error: "world_id, name 은 필수입니다." }, { status: 400 });
  }
  const result = await execute(
    `INSERT INTO characters (world_id, name, profile, personality, speech_style, ai_prompt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [world_id, name, profile, personality, speech_style, ai_prompt]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
