import { NextRequest, NextResponse } from "next/server";
import { query, execute, getPool, type AiLevel } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<AiLevel>("SELECT * FROM ai_levels WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cur = rows[0];
  const b = await req.json();
  const name = b.name ?? cur.name;
  if (!name) return NextResponse.json({ error: "name 은 필수입니다." }, { status: 400 });
  const description = b.description !== undefined ? b.description || null : cur.description;
  const level = b.level !== undefined ? Number(b.level) : cur.level;
  if (!Number.isInteger(level) || level < 0) {
    return NextResponse.json({ error: "레벨 번호는 0 이상의 정수여야 합니다." }, { status: 400 });
  }
  const kind = b.kind ?? cur.kind;
  if (kind !== "browser" && kind !== "server") {
    return NextResponse.json({ error: "kind 는 browser/server 만 가능합니다." }, { status: 400 });
  }
  const chatCost =
    b.chat_cost !== undefined ? Math.max(0, Math.floor(Number(b.chat_cost) || 0)) : cur.chat_cost;
  const isActive = b.is_active !== undefined ? (b.is_active ? 1 : 0) : cur.is_active;
  // 기본 레벨은 항상 1개 유지 — 새로 기본으로 지정하면 나머지는 0, 현재 기본의 해제 요청은 무시
  const isDefault = cur.is_default ? 1 : b.is_default ? 1 : 0;

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    if (isDefault) await conn.query("UPDATE ai_levels SET is_default = 0 WHERE id <> ?", [id]);
    await conn.query(
      `UPDATE ai_levels SET name = ?, description = ?, level = ?, kind = ?, chat_cost = ?,
         is_active = ?, is_default = ? WHERE id = ?`,
      [name, description, level, kind, chatCost, isActive, isDefault, id]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "이미 있는 레벨 번호입니다." }, { status: 400 });
    }
    throw e;
  } finally {
    conn.release();
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<AiLevel>("SELECT * FROM ai_levels WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (rows[0].is_default) {
    return NextResponse.json({ error: "기본 레벨은 삭제할 수 없습니다." }, { status: 400 });
  }
  await execute("DELETE FROM ai_levels WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
