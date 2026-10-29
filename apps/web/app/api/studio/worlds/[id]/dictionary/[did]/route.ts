import { NextRequest, NextResponse } from "next/server";
import { query, execute, embedPassage, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedWorld, resolveOwnCharacterScope, bad } from "@/lib/studio";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string; did: string }> };

/** 사전 항목이 해당 세계관(내 소유)에 속하는지 확인. 문제 있으면 응답 반환 */
async function checkEntry(id: string, did: string, userId: number) {
  const own = await ownedWorld(id, userId);
  if ("res" in own) return own.res;
  const rows = await query("SELECT id FROM world_dictionary WHERE id = ? AND world_id = ?", [Number(did), Number(id)]);
  if (rows.length === 0) return bad("찾을 수 없습니다.", 404);
  return null;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, did } = await params;
  const err = await checkEntry(id, did, auth.userId);
  if (err) return err;
  const body = await req.json().catch(() => ({}));
  // 연결 캐릭터만 바꾸는 요청(title 없음): 임베딩 재생성 없이 컬럼만 갱신 (이 세계관 소속 + 내 소유 캐릭터)
  if ("linked_character_id" in body && body.title === undefined) {
    const linked = await resolveOwnCharacterScope(id, body.linked_character_id, auth.userId);
    if ("res" in linked) return linked.res;
    await execute("UPDATE world_dictionary SET linked_character_id = ? WHERE id = ? AND world_id = ?", [
      linked.characterId,
      Number(did),
      Number(id),
    ]);
    await invalidateChatContext();
    return NextResponse.json({ ok: true });
  }
  const { category, title, aliases = null, content = "", sort_order = 0 } = body;
  if (!["location", "person", "term"].includes(category) || !title) {
    return bad("category, title 은 필수입니다.");
  }
  // character_id 가 body 에 있을 때만 범위 수정 (없으면 기존 값 유지)
  let scopeSql = "";
  const scopeParams: (number | null)[] = [];
  if ("character_id" in body) {
    const scope = await resolveOwnCharacterScope(id, body.character_id, auth.userId);
    if ("res" in scope) return scope.res;
    scopeSql = ", character_id = ?";
    scopeParams.push(scope.characterId);
  }
  let embedding: string | null = null;
  let warning: string | undefined;
  try {
    embedding = JSON.stringify(await embedPassage(`${title} ${aliases ?? ""} ${content}`));
  } catch (e) {
    console.error("embedding error:", e);
    warning = "임베딩 생성 실패 — 키워드 검색만 적용됩니다";
  }
  await execute(
    `UPDATE world_dictionary
     SET category = ?, title = ?, aliases = ?, content = ?, embedding = ?, sort_order = ?${scopeSql}
     WHERE id = ? AND world_id = ?`,
    [category, title, aliases, content, embedding, Number(sort_order) || 0, ...scopeParams, Number(did), Number(id)]
  );
  await invalidateChatContext();
  return NextResponse.json({ ok: true, ...(warning && { warning }) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, did } = await params;
  const err = await checkEntry(id, did, auth.userId);
  if (err) return err;
  await execute("DELETE FROM world_dictionary WHERE id = ? AND world_id = ?", [Number(did), Number(id)]);
  await invalidateChatContext();
  return NextResponse.json({ ok: true });
}
