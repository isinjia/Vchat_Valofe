import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const rows = await query(
    `SELECT r.*, d.title AS target_title, d.category AS target_category, d.linked_character_id
     FROM character_relationships r
     JOIN world_dictionary d ON d.id = r.target_entry_id
     WHERE r.character_id = ?
     ORDER BY d.category, r.id`,
    [Number(id)]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const b = await req.json().catch(() => ({}));
  const entryId = Number(b.target_entry_id);
  const relation = typeof b.relation === "string" ? b.relation.trim() : "";
  if (!Number.isInteger(entryId) || entryId <= 0 || !relation) {
    return bad("target_entry_id, relation 은 필수입니다.");
  }
  // 대상은 이 캐릭터 세계관의 공통 사전 항목(인물·지역·용어)이어야 함
  const ok = await query(
    "SELECT id FROM world_dictionary WHERE id = ? AND world_id = ? AND character_id IS NULL",
    [entryId, Number(own.row.world_id)]
  );
  if (ok.length === 0) return bad("이 캐릭터의 세계관에 속한 공통 사전 항목이 아닙니다.");
  const result = await execute(
    `INSERT INTO character_relationships (character_id, target_entry_id, relation)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE relation = VALUES(relation)`,
    [Number(id), entryId, relation]
  );
  await invalidateChatContext(Number(id));
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
