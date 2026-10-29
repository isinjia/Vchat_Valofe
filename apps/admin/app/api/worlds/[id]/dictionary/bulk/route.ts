import { NextRequest, NextResponse } from "next/server";
import { query, execute, embedPassage, invalidateChatContext } from "@vchatbot/core";
import { resolveCharacterScope } from "@/lib/dictionary-scope";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

const CATEGORIES = ["location", "person", "term"];
const MAX_ENTRIES = 200;

/** POST /api/worlds/:id/dictionary/bulk  { entries: [...], character_id?: number|null } */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const entries: unknown = body?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: "entries 배열이 필요합니다." }, { status: 400 });
  }
  if (entries.length > MAX_ENTRIES) {
    return NextResponse.json({ error: `한 번에 최대 ${MAX_ENTRIES}개까지 등록할 수 있습니다.` }, { status: 400 });
  }
  for (const e of entries) {
    if (!e || !CATEGORIES.includes(e.category) || typeof e.title !== "string" || !e.title.trim()) {
      return NextResponse.json({ error: "category/title 이 올바르지 않은 항목이 있습니다." }, { status: 400 });
    }
  }

  // 전체 entries 에 일괄 적용할 범위 (null=세계관 공통)
  const scope = await resolveCharacterScope(id, body?.character_id);
  if ("error" in scope) return NextResponse.json({ error: scope.error }, { status: 400 });
  const characterId = scope.characterId;

  let inserted = 0;
  let skipped = 0;
  let embedFailed = 0;
  // 순차 처리 (임베딩 서버 부하 보호)
  for (const e of entries) {
    const title = e.title.trim();
    const aliases: string | null = typeof e.aliases === "string" && e.aliases.trim() ? e.aliases.trim() : null;
    const content: string = typeof e.content === "string" ? e.content : "";

    const dup = await query(
      "SELECT id FROM world_dictionary WHERE world_id = ? AND character_id <=> ? AND category = ? AND title = ? LIMIT 1",
      [id, characterId, e.category, title]
    );
    if (dup.length > 0) {
      skipped++;
      continue;
    }

    let embedding: string | null = null;
    try {
      embedding = JSON.stringify(await embedPassage(`${title} ${aliases ?? ""} ${content}`));
    } catch (err) {
      console.error("embedding error:", err);
      embedFailed++;
    }
    await execute(
      `INSERT INTO world_dictionary (world_id, character_id, category, title, aliases, content, embedding, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, characterId, e.category, title, aliases, content, embedding, 0]
    );
    inserted++;
  }

  await invalidateChatContext();
  return NextResponse.json({ inserted, skipped, embedFailed });
}
