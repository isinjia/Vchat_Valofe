import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** GET: 캐릭터가 받은 선물 — 아이템별 집계 + 최근 사용 내역 (최근 100건) */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const cid = Number(id);
  if (!Number.isInteger(cid) || cid <= 0) return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });

  const [summary, recent, totals] = await Promise.all([
    query(
      `SELECT item_name, COUNT(*) AS cnt, SUM(price) AS total, COUNT(DISTINCT user_id) AS users
       FROM item_uses WHERE character_id = ? GROUP BY item_name ORDER BY total DESC`,
      [cid]
    ),
    query(
      `SELECT u.id, u.item_name, u.price, u.affinity_applied, u.created_at,
              us.nickname AS user_nickname, us.id AS user_id
       FROM item_uses u
       LEFT JOIN users us ON us.id = u.user_id
       WHERE u.character_id = ?
       ORDER BY u.id DESC LIMIT 100`,
      [cid]
    ),
    query<{ cnt: number; total: number }>(
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(price), 0) AS total FROM item_uses WHERE character_id = ?",
      [cid]
    ),
  ]);
  return NextResponse.json({
    summary,
    recent,
    totalCount: Number(totals[0]?.cnt ?? 0),
    totalAmount: Number(totals[0]?.total ?? 0),
  });
}
