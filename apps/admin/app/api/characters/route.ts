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
  // 세계관 내 캐릭터명 중복 검사
  const dup = await query("SELECT id FROM characters WHERE world_id = ? AND name = ? LIMIT 1", [world_id, name]);
  if (dup.length > 0) return NextResponse.json({ error: "이 세계관에 같은 이름의 캐릭터가 이미 있습니다." }, { status: 400 });
  try {
    const result = await execute(
      `INSERT INTO characters (world_id, name, profile, personality, speech_style, ai_prompt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [world_id, name, profile, personality, speech_style, ai_prompt]
    );
    return NextResponse.json({ id: result.insertId }, { status: 201 });
  } catch (e) {
    // UNIQUE 제약 위반 (동시 요청 레이스 대비)
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "이 세계관에 같은 이름의 캐릭터가 이미 있습니다." }, { status: 400 });
    throw e;
  }
}
