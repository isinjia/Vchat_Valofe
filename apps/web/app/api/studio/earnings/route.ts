import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { requireUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

const FEE_TYPES = "('chat_fee_income','gift_fee_income','world_fee_income')";

/**
 * GET /api/studio/earnings?month=YYYY-MM (기본: 이번 달)
 * 내 수수료 정산 지표: 이번 달/지난달 합계, 최근 6개월 추이,
 * 선택한 달의 캐릭터별(대화 수수료)·아이템별(선물 판매) 상세.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const uid = auth.userId;

  const now = new Date();
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const thisMonth = ym(now);
  const lastMonth = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const reqMonth = /^\d{4}-\d{2}$/.test(req.nextUrl.searchParams.get("month") ?? "")
    ? (req.nextUrl.searchParams.get("month") as string)
    : thisMonth;

  const sumOf = async (month: string) => {
    const rows = await query<{ type: string; total: number; cnt: number }>(
      `SELECT type, SUM(amount) AS total, COUNT(*) AS cnt
       FROM coin_transactions
       WHERE user_id = ? AND type IN ${FEE_TYPES} AND DATE_FORMAT(created_at, '%Y-%m') = ?
       GROUP BY type`,
      [uid, month]
    );
    const m: Record<string, number> = { chat_fee_income: 0, gift_fee_income: 0, world_fee_income: 0 };
    for (const r of rows) m[r.type] = Number(r.total) || 0;
    return { chat: m.chat_fee_income, gift: m.gift_fee_income, world: m.world_fee_income, total: m.chat_fee_income + m.gift_fee_income + m.world_fee_income };
  };

  const [cur, prev, monthlyRows, byCharacter, byItem] = await Promise.all([
    sumOf(thisMonth),
    sumOf(lastMonth),
    query<{ month: string; type: string; total: number }>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, type, SUM(amount) AS total
       FROM coin_transactions
       WHERE user_id = ? AND type IN ${FEE_TYPES} AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY month, type ORDER BY month`,
      [uid]
    ),
    // 선택한 달 — 캐릭터별 수수료 (채팅/선물 각각: 건수 + 합계)
    query<{ character_id: number; name: string | null; type: string; cnt: number; total: number }>(
      `SELECT t.ref_id AS character_id, c.name, t.type, COUNT(*) AS cnt, SUM(t.amount) AS total
       FROM coin_transactions t
       LEFT JOIN characters c ON c.id = t.ref_id
       WHERE t.user_id = ? AND t.type IN ('chat_fee_income','gift_fee_income')
         AND t.ref_type = 'character' AND DATE_FORMAT(t.created_at, '%Y-%m') = ?
       GROUP BY t.ref_id, c.name, t.type`,
      [uid, reqMonth]
    ),
    // 선택한 달 — 아이템별 판매 (내 캐릭터가 받은 선물: 판매수/판매액/내 수수료)
    query<{ item_name: string; cnt: number; sales: number; fee: number }>(
      `SELECT u.item_name, COUNT(*) AS cnt, SUM(u.price) AS sales, SUM(u.creator_fee - u.world_fee) AS fee
       FROM item_uses u
       JOIN characters c ON c.id = u.character_id
       WHERE c.owner_user_id = ? AND u.user_id <> ? AND DATE_FORMAT(u.created_at, '%Y-%m') = ?
       GROUP BY u.item_name ORDER BY sales DESC`,
      [uid, uid, reqMonth]
    ),
  ]);

  // 캐릭터별 rows 를 캐릭터 단위로 합치기
  const charMap = new Map<number, { characterId: number; name: string; chatCount: number; chatFee: number; giftCount: number; giftFee: number }>();
  for (const r of byCharacter) {
    const e = charMap.get(r.character_id) ?? {
      characterId: r.character_id,
      name: r.name ?? `#${r.character_id}`,
      chatCount: 0,
      chatFee: 0,
      giftCount: 0,
      giftFee: 0,
    };
    if (r.type === "chat_fee_income") {
      e.chatCount = Number(r.cnt);
      e.chatFee = Number(r.total) || 0;
    } else {
      e.giftCount = Number(r.cnt);
      e.giftFee = Number(r.total) || 0;
    }
    charMap.set(r.character_id, e);
  }

  const monthlyMap = new Map<string, { month: string; chat: number; gift: number; world: number }>();
  for (const r of monthlyRows) {
    const e = monthlyMap.get(r.month) ?? { month: r.month, chat: 0, gift: 0, world: 0 };
    if (r.type === "chat_fee_income") e.chat = Number(r.total) || 0;
    else if (r.type === "gift_fee_income") e.gift = Number(r.total) || 0;
    else e.world = Number(r.total) || 0;
    monthlyMap.set(r.month, e);
  }

  return NextResponse.json({
    thisMonth: { month: thisMonth, ...cur },
    lastMonth: { month: lastMonth, ...prev },
    monthly: [...monthlyMap.values()].map((m) => ({ ...m, total: m.chat + m.gift + m.world })),
    detailMonth: reqMonth,
    byCharacter: [...charMap.values()].sort((a, b) => b.chatFee + b.giftFee - (a.chatFee + a.giftFee)),
    byItem: byItem.map((r) => ({ name: r.item_name, count: Number(r.cnt), sales: Number(r.sales) || 0, fee: Number(r.fee) || 0 })),
  });
}
