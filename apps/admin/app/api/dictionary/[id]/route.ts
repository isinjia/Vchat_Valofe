import { NextRequest, NextResponse } from "next/server";
import { execute, embedPassage, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { category, title, aliases = null, content, sort_order = 0 } = await req.json();
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
     SET category = ?, title = ?, aliases = ?, content = ?, embedding = ?, sort_order = ?
     WHERE id = ?`,
    [category, title, aliases, content, embedding, sort_order, id]
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
