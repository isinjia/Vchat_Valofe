import { NextRequest, NextResponse } from "next/server";
import { query, execute, embedPassage, invalidateChatContext } from "@vchatbot/core";
import { resolveCharacterScope } from "@/lib/dictionary-scope";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  // 벡터 전체는 UI 로 보내지 않고 존재 여부만 전달
  const rows = await query(
    `SELECT d.id, d.world_id, d.character_id, c.name AS character_name,
            d.linked_character_id, lc.name AS linked_character_name,
            d.category, d.title, d.aliases, d.content, d.sort_order,
            (d.embedding IS NOT NULL) AS has_embedding
     FROM world_dictionary d LEFT JOIN characters c ON c.id = d.character_id
     LEFT JOIN characters lc ON lc.id = d.linked_character_id
     WHERE d.world_id = ? ORDER BY d.category, d.sort_order, d.id`,
    [id]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { category, title, aliases = null, content = "", sort_order = 0, character_id = null } = await req.json();
  if (!category || !title) {
    return NextResponse.json({ error: "category, title 은 필수입니다." }, { status: 400 });
  }
  // 범위: null=세계관 공통, 값=해당 캐릭터 전용 (세계관 소속 검증)
  const scope = await resolveCharacterScope(id, character_id);
  if ("error" in scope) return NextResponse.json({ error: scope.error }, { status: 400 });
  let embedding: string | null = null;
  let warning: string | undefined;
  try {
    embedding = JSON.stringify(await embedPassage(`${title} ${aliases ?? ""} ${content}`));
  } catch (err) {
    console.error("embedding error:", err);
    warning = "임베딩 생성 실패 — 키워드 검색만 적용됩니다";
  }
  const result = await execute(
    `INSERT INTO world_dictionary (world_id, character_id, category, title, aliases, content, embedding, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, scope.characterId, category, title, aliases, content, embedding, sort_order]
  );
  await invalidateChatContext();
  return NextResponse.json({ id: result.insertId, ...(warning && { warning }) }, { status: 201 });
}
