import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query(
    `SELECT r.*, c.name AS target_name
     FROM character_relationships r
     JOIN characters c ON c.id = r.target_character_id
     WHERE r.character_id = ?`,
    [id]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { target_character_id, relation } = await req.json();
  if (!target_character_id || !relation) {
    return NextResponse.json(
      { error: "target_character_id, relation 은 필수입니다." },
      { status: 400 }
    );
  }
  const result = await execute(
    `INSERT INTO character_relationships (character_id, target_character_id, relation)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE relation = VALUES(relation)`,
    [id, target_character_id, relation]
  );
  await invalidateChatContext(Number(id));
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
