import { NextRequest, NextResponse } from "next/server";
import { query, execute, embedPassage, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string; did: string }> };

/** 내 캐릭터의 전용 항목(character_id 가 이 캐릭터)인지 확인. 문제 있으면 응답 반환 */
async function check(id: string, did: string, userId: number) {
  const own = await ownedCharacter(id, userId);
  if ("res" in own) return { res: own.res };
  const rows = await query("SELECT id FROM world_dictionary WHERE id = ? AND character_id = ?", [
    Number(did),
    Number(own.row.id),
  ]);
  if (rows.length === 0) return { res: bad("찾을 수 없습니다.", 404) };
  return { characterId: Number(own.row.id) };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, did } = await params;
  const c = await check(id, did, auth.userId);
  if ("res" in c) return c.res;
  const { category, title, aliases = null, content = "", sort_order = 0 } = await req.json().catch(() => ({}));
  if (!["location", "person", "term"].includes(category) || !title) {
    return bad("category, title 은 필수입니다.");
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
     SET category = ?, title = ?, aliases = ?, content = ?, embedding = ?, sort_order = ?
     WHERE id = ? AND character_id = ?`,
    [category, title, aliases, content, embedding, Number(sort_order) || 0, Number(did), c.characterId]
  );
  await invalidateChatContext(c.characterId);
  return NextResponse.json({ ok: true, ...(warning && { warning }) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, did } = await params;
  const c = await check(id, did, auth.userId);
  if ("res" in c) return c.res;
  await execute("DELETE FROM world_dictionary WHERE id = ? AND character_id = ?", [Number(did), c.characterId]);
  await invalidateChatContext(c.characterId);
  return NextResponse.json({ ok: true });
}
