import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** GET: 유저의 아이템 사용 내역 (최근 100건) + 아이템별 합계 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const uid = Number(id);
  if (!Number.isInteger(uid) || uid <= 0) return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });

  const [recent, summary] = await Promise.all([
    query(
      `SELECT u.id, u.item_name, u.price, u.affinity_applied, u.created_at,
              c.name AS character_name, w.name AS world_name
       FROM item_uses u
       LEFT JOIN characters c ON c.id = u.character_id
       LEFT JOIN worlds w ON w.id = u.world_id
       WHERE u.user_id = ?
       ORDER BY u.id DESC LIMIT 100`,
      [uid]
    ),
    query(
      `SELECT item_name, COUNT(*) AS cnt, SUM(price) AS total
       FROM item_uses WHERE user_id = ? GROUP BY item_name ORDER BY total DESC`,
      [uid]
    ),
  ]);
  return NextResponse.json({ recent, summary });
}
