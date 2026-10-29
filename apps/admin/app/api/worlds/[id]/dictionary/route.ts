import { NextRequest, NextResponse } from "next/server";
import { query, execute, embedPassage, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  // 벡터 전체는 UI 로 보내지 않고 존재 여부만 전달
  const rows = await query(
    `SELECT id, world_id, category, title, aliases, content, sort_order,
            (embedding IS NOT NULL) AS has_embedding
     FROM world_dictionary WHERE world_id = ? ORDER BY category, sort_order, id`,
    [id]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { category, title, aliases = null, content = "", sort_order = 0 } = await req.json();
  if (!category || !title) {
    return NextResponse.json({ error: "category, title 은 필수입니다." }, { status: 400 });
  }
  let embedding: string | null = null;
  let warning: string | undefined;
  try {
    embedding = JSON.stringify(await embedPassage(`${title} ${aliases ?? ""} ${content}`));
  } catch (err) {
    console.error("embedding error:", err);
    warning = "임베딩 생성 실패 — 키워드 검색만 적용됩니다";
  }
  const result = await execute(
    `INSERT INTO world_dictionary (world_id, category, title, aliases, content, embedding, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, category, title, aliases, content, embedding, sort_order]
  );
  await invalidateChatContext();
  return NextResponse.json({ id: result.insertId, ...(warning && { warning }) }, { status: 201 });
}
