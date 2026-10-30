import { NextRequest, NextResponse } from "next/server";
import { query, execute, getPool, type ChatTier } from "@vchatbot/core";
import { sanitizeConditions } from "../conditions";

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
  // 아이콘: 이모지 또는 이미지 URL (255자 제한)
  const icon =
    b.icon !== undefined ? (String(b.icon).trim().slice(0, 255) || null) : (cur.icon ?? null);
  // 기본 등급은 항상 1개 유지 — 새로 기본으로 지정하면 나머지는 0, 현재 기본의 해제 요청은 무시
  const chatCost =
    b.chat_cost !== undefined ? Math.max(0, Math.floor(Number(b.chat_cost) || 0)) : cur.chat_cost;
  const discountRate =
    b.discount_rate !== undefined
      ? Math.min(100, Math.max(0, Number(b.discount_rate) || 0))
      : Number(cur.discount_rate ?? 0);
  const track = b.track !== undefined ? b.track : cur.track;
  if (track !== "user" && track !== "creator") {
    return NextResponse.json({ error: "track 은 user/creator 만 가능합니다." }, { status: 400 });
  }
  const tierRank = b.tier_rank !== undefined ? Number(b.tier_rank) : Number(cur.tier_rank ?? 0);
  if (!Number.isInteger(tierRank) || tierRank < 0) {
    return NextResponse.json({ error: "tier_rank 는 0 이상 정수여야 합니다." }, { status: 400 });
  }
  const feeBonus =
    b.fee_bonus !== undefined ? Math.max(0, Number(b.fee_bonus) || 0) : Number(cur.fee_bonus ?? 0);
  const isOverride = b.is_override !== undefined ? (b.is_override ? 1 : 0) : (cur.is_override ? 1 : 0);
  // conditions: 전달 시 필터 후 저장(빈 객체/비객체면 NULL), 미전달 시 유지
  let conditions: string | null;
  if (b.conditions !== undefined) {
    conditions = sanitizeConditions(b.conditions);
  } else {
    const c = cur.conditions as unknown;
    conditions = c == null ? null : typeof c === "string" ? c : JSON.stringify(c);
  }
  // is_default 는 user 트랙에서만 의미 있음
  const isDefault = track !== "user" ? 0 : cur.is_default ? 1 : b.is_default ? 1 : 0;

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    if (isDefault) await conn.query("UPDATE chat_tiers SET is_default = 0 WHERE id <> ?", [id]);
    await conn.query(
      `UPDATE chat_tiers SET name = ?, icon = ?, description = ?, is_default = ?, chat_cost = ?, discount_rate = ?,
         track = ?, tier_rank = ?, is_override = ?, fee_bonus = ?, conditions = ? WHERE id = ?`,
      [name, icon, description, isDefault, chatCost, discountRate, track, tierRank, isOverride, feeBonus, conditions, id]
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
