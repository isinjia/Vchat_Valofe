import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/sales?days=7|14|30 — 판매지표 (코인 소비 기준)
 *   아이템 = gift_spend, 채팅 = chat_spend, 지원 = ai_assist/illust_gen/video_gen_spend
 * 응답: { items: [{date, gift, chat, support, total}], totals: {...} }
 */
export async function GET(req: NextRequest) {
  const daysRaw = Number(req.nextUrl.searchParams.get("days"));
  const days = [7, 14, 30].includes(daysRaw) ? daysRaw : 30;

  const rows = await query<{ date: string; type: string; total: number }>(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date, type, SUM(-amount) AS total
     FROM coin_transactions
     WHERE amount < 0
       AND type IN ('gift_spend','chat_spend','ai_assist_spend','illust_gen_spend','video_gen_spend')
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY date, type
     ORDER BY date`,
    [days - 1]
  );

  // 날짜 축을 빈 날 포함으로 채운다
  const byDate = new Map<string, { date: string; gift: number; chat: number; support: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    byDate.set(key, { date: key, gift: 0, chat: 0, support: 0 });
  }
  for (const r of rows) {
    const e = byDate.get(r.date);
    if (!e) continue;
    const v = Number(r.total) || 0;
    if (r.type === "gift_spend") e.gift += v;
    else if (r.type === "chat_spend") e.chat += v;
    else e.support += v;
  }
  const items = [...byDate.values()].map((e) => ({ ...e, total: e.gift + e.chat + e.support }));
  const totals = items.reduce(
    (a, e) => ({ gift: a.gift + e.gift, chat: a.chat + e.chat, support: a.support + e.support, total: a.total + e.total }),
    { gift: 0, chat: 0, support: 0, total: 0 }
  );
  return NextResponse.json({ days, items, totals });
}
