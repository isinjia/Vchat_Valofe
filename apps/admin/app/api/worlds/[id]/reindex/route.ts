import { NextRequest, NextResponse } from "next/server";
import { query, execute, embedPassage, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** POST /api/worlds/:id/reindex — 해당 세계관 사전 전체를 순차로 재임베딩 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<{ id: number; title: string; aliases: string | null; content: string }>(
    "SELECT id, title, aliases, content FROM world_dictionary WHERE world_id = ?",
    [id]
  );
  let indexed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const vec = await embedPassage(`${r.title} ${r.aliases ?? ""} ${r.content}`);
      await execute("UPDATE world_dictionary SET embedding = ? WHERE id = ?", [
        JSON.stringify(vec),
        r.id,
      ]);
      indexed++;
    } catch (err) {
      console.error("reindex error:", r.id, err);
      failed++;
    }
  }
  await invalidateChatContext();
  return NextResponse.json({ total: rows.length, indexed, failed });
}
