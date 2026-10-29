import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

/** 노출 조건/종류/설명 수정 (파일 교체는 삭제 후 재업로드) */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { kind, description = null, keywords = [], sort_order = 0 } = await req.json();
  const triggerCondition =
    kind === "conditional" && Array.isArray(keywords) && keywords.length > 0
      ? JSON.stringify({ type: "keyword", keywords })
      : null;
  await execute(
    `UPDATE illustrations SET kind = ?, description = ?, trigger_condition = ?, sort_order = ?
     WHERE id = ?`,
    [kind, description, triggerCondition, sort_order, id]
  );
  await invalidateChatContext();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<{ storage_key: string; character_id: number }>(
    "SELECT storage_key, character_id FROM illustrations WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  await execute("DELETE FROM illustrations WHERE id = ?", [id]);
  try {
    const storage = await getStorage();
    await storage.remove(rows[0].storage_key);
  } catch {
    // 스토리지 삭제 실패는 DB 삭제를 막지 않음 (orphan 파일 허용)
  }
  await invalidateChatContext(rows[0].character_id);
  return NextResponse.json({ ok: true });
}
