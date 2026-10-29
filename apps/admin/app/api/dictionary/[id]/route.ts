import { NextRequest, NextResponse } from "next/server";
import { query, execute, embedPassage, invalidateChatContext } from "@vchatbot/core";
import { resolveCharacterScope } from "@/lib/dictionary-scope";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  // 연결 캐릭터만 바꾸는 요청(title 없음)은 임베딩 재생성 없이 컬럼만 갱신
  if ("linked_character_id" in body && body.title === undefined) {
    const rows = await query<{ world_id: number }>("SELECT world_id FROM world_dictionary WHERE id = ?", [id]);
    if (rows.length === 0) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
    const linked = await resolveCharacterScope(rows[0].world_id, body.linked_character_id);
    if ("error" in linked) return NextResponse.json({ error: linked.error }, { status: 400 });
    await execute("UPDATE world_dictionary SET linked_character_id = ? WHERE id = ?", [linked.characterId, id]);
    await invalidateChatContext();
    return NextResponse.json({ ok: true });
  }
  const { category, title, aliases = null, content, sort_order = 0 } = body;
  // character_id 가 body 에 있을 때만 범위 수정 (없으면 기존 값 유지)
  let scopeSql = "";
  const scopeParams: (number | null)[] = [];
  if ("character_id" in body) {
    const rows = await query<{ world_id: number }>("SELECT world_id FROM world_dictionary WHERE id = ?", [id]);
    if (rows.length === 0) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
    const scope = await resolveCharacterScope(rows[0].world_id, body.character_id);
    if ("error" in scope) return NextResponse.json({ error: scope.error }, { status: 400 });
    scopeSql = ", character_id = ?";
    scopeParams.push(scope.characterId);
  }
  // linked_character_id 가 body 에 있을 때만 연결 캐릭터 수정 (같은 세계관 캐릭터인지 검증)
  if ("linked_character_id" in body) {
    const rows = await query<{ world_id: number }>("SELECT world_id FROM world_dictionary WHERE id = ?", [id]);
    if (rows.length === 0) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
    const linked = await resolveCharacterScope(rows[0].world_id, body.linked_character_id);
    if ("error" in linked) return NextResponse.json({ error: linked.error }, { status: 400 });
    scopeSql += ", linked_character_id = ?";
    scopeParams.push(linked.characterId);
  }
  let embedding: string | null = null;
  let warning: string | undefined;
  try {
    embedding = JSON.stringify(await embedPassage(`${title} ${aliases ?? ""} ${content}`));
  } catch (err) {
    console.error("embedding error:", err);
    warning = "임베딩 생성 실패 — 키워드 검색만 적용됩니다";
  }
  await execute(
    `UPDATE world_dictionary
     SET category = ?, title = ?, aliases = ?, content = ?, embedding = ?, sort_order = ?${scopeSql}
     WHERE id = ?`,
    [category, title, aliases, content, embedding, sort_order, ...scopeParams, id]
  );
  await invalidateChatContext();
  return NextResponse.json({ ok: true, ...(warning && { warning }) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await execute("DELETE FROM world_dictionary WHERE id = ?", [id]);
  await invalidateChatContext();
  return NextResponse.json({ ok: true });
}
