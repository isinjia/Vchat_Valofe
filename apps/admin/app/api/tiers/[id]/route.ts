import { NextRequest, NextResponse } from "next/server";
import { query, execute, getPool, type ChatTier } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<ChatTier>("SELECT * FROM chat_tiers WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cur = rows[0];
  const b = await req.json();
  const name = b.name ?? cur.name;
  if (!name) return NextResponse.json({ error: "name 은 필수입니다." }, { status: 400 });
  const description = b.description !== undefined ? b.description || null : cur.description;
  // 기본 등급은 항상 1개 유지 — 새로 기본으로 지정하면 나머지는 0, 현재 기본의 해제 요청은 무시
  const chatCost =
    b.chat_cost !== undefined ? Math.max(0, Math.floor(Number(b.chat_cost) || 0)) : cur.chat_cost;
  const isDefault = cur.is_default ? 1 : b.is_default ? 1 : 0;

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    if (isDefault) await conn.query("UPDATE chat_tiers SET is_default = 0 WHERE id <> ?", [id]);
    await conn.query(
      "UPDATE chat_tiers SET name = ?, description = ?, is_default = ?, chat_cost = ? WHERE id = ?",
      [name, description, isDefault, chatCost, id]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<ChatTier>("SELECT * FROM chat_tiers WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (rows[0].is_default) {
    return NextResponse.json({ error: "기본 등급은 삭제할 수 없습니다." }, { status: 400 });
  }
  await execute("DELETE FROM chat_tiers WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
