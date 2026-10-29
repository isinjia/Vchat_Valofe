import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  // 대상 = 세계관 사전 항목 (인물·지역·용어)
  const rows = await query(
    `SELECT r.*, d.title AS target_title, d.category AS target_category, d.linked_character_id
     FROM character_relationships r
     JOIN world_dictionary d ON d.id = r.target_entry_id
     WHERE r.character_id = ?
     ORDER BY d.category, r.id`,
    [id]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { target_entry_id, relation } = await req.json();
  if (!target_entry_id || !relation) {
    return NextResponse.json(
      { error: "target_entry_id, relation 은 필수입니다." },
      { status: 400 }
    );
  }
  // 대상 항목이 이 캐릭터의 세계관 소속 공통 항목(인물/지역/용어)인지 검증
  const ok = await query(
    `SELECT d.id FROM world_dictionary d
     JOIN characters c ON c.world_id = d.world_id
     WHERE d.id = ? AND c.id = ? AND d.character_id IS NULL`,
    [target_entry_id, id]
  );
  if (ok.length === 0) {
    return NextResponse.json(
      { error: "이 캐릭터의 세계관에 속한 공통 사전 항목이 아닙니다." },
      { status: 400 }
    );
  }
  const result = await execute(
    `INSERT INTO character_relationships (character_id, target_entry_id, relation)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE relation = VALUES(relation)`,
    [id, target_entry_id, relation]
  );
  await invalidateChatContext(Number(id));
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
