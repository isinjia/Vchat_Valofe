import { NextRequest, NextResponse } from "next/server";
import { query, execute, embedPassage, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedWorld, resolveOwnCharacterScope, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  // 벡터 전체는 UI 로 보내지 않고 존재 여부만 전달
  const rows = await query(
    `SELECT d.id, d.world_id, d.character_id, c.name AS character_name, d.linked_character_id,
            d.category, d.title, d.aliases, d.content, d.sort_order,
            (d.embedding IS NOT NULL) AS has_embedding
     FROM world_dictionary d LEFT JOIN characters c ON c.id = d.character_id
     WHERE d.world_id = ? ORDER BY d.category, d.sort_order, d.id`,
    [Number(id)]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  const { category, title, aliases = null, content = "", sort_order = 0, character_id = null } = await req.json().catch(() => ({}));
  if (!["location", "person", "term"].includes(category) || !title) {
    return bad("category, title 은 필수입니다.");
  }
  // 범위: null=세계관 공통, 값=내 캐릭터이며 이 세계관 소속이어야 함
  const scope = await resolveOwnCharacterScope(id, character_id, auth.userId);
  if ("res" in scope) return scope.res;
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
    [Number(id), scope.characterId, category, title, aliases, content, embedding, Number(sort_order) || 0]
  );
  await invalidateChatContext();
  return NextResponse.json({ id: result.insertId, ...(warning && { warning }) }, { status: 201 });
}
