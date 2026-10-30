import { NextRequest, NextResponse } from "next/server";
import { query, chatMessages } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/** KST(UTC+9) 기준 YYYY-MM-DD */
function kstDateStr(d: Date): string {
  const t = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

/**
 * GET /api/stats/daily?days=30 — 일별 기본 지표 (KST 기준)
 *   nu: 신규 가입 유저 수
 *   dau: 그 날 유저 메시지를 보낸 고유 유저 수
 *   messages: 유저가 보낸 메시지 수
 *   pu: 그 날 코인을 소비한 고유 유저 수 (결제 도입 전 임시 PU 정의)
 *   coinsSpent: 소비된 코인 합계
 */
export async function GET(req: NextRequest) {
  const daysRaw = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = Number.isInteger(daysRaw) ? Math.min(90, Math.max(7, daysRaw)) : 30;
  // KST 기준 오늘 포함 days 일 — 시작 시각(UTC)
  const todayKst = kstDateStr(new Date());
  const startUtc = new Date(new Date(`${todayKst}T00:00:00+09:00`).getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const [nuRows, puRows, col] = await Promise.all([
    query<{ d: string; n: number }>(
      `SELECT DATE(DATE_ADD(created_at, INTERVAL 9 HOUR)) AS d, COUNT(*) AS n
       FROM users WHERE created_at >= ? GROUP BY d`,
      [startUtc]
    ),
    query<{ d: string; n: number; spent: number | string }>(
      `SELECT DATE(DATE_ADD(created_at, INTERVAL 9 HOUR)) AS d,
              COUNT(DISTINCT user_id) AS n, COALESCE(SUM(-amount), 0) AS spent
       FROM coin_transactions WHERE amount < 0 AND created_at >= ? GROUP BY d`,
      [startUtc]
    ),
    chatMessages(),
  ]);

  const chatAgg = await col
    .aggregate<{ _id: string; messages: number; users: number }>([
      { $match: { role: "user", createdAt: { $gte: startUtc } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+09:00" } },
          messages: { $sum: 1 },
          userSet: { $addToSet: "$userId" },
        },
      },
      { $project: { messages: 1, users: { $size: "$userSet" } } },
    ])
    .toArray();

  const toKey = (v: unknown) => String(v).slice(0, 10);
  const nuMap = new Map(nuRows.map((r) => [toKey(r.d), Number(r.n)]));
  const puMap = new Map(puRows.map((r) => [toKey(r.d), { n: Number(r.n), spent: Number(r.spent) }]));
  const chatMap = new Map(chatAgg.map((r) => [r._id, r]));

  // 빈 날짜를 0 으로 채워 연속된 시계열로
  const items: { date: string; nu: number; dau: number; pu: number; messages: number; coinsSpent: number }[] = [];
  for (let i = 0; i < days; i++) {
    const date = kstDateStr(new Date(startUtc.getTime() + i * 24 * 60 * 60 * 1000));
    const chat = chatMap.get(date);
    const pu = puMap.get(date);
    items.push({
      date,
      nu: nuMap.get(date) ?? 0,
      dau: chat?.users ?? 0,
      pu: pu?.n ?? 0,
      messages: chat?.messages ?? 0,
      coinsSpent: pu?.spent ?? 0,
    });
  }
  return NextResponse.json({ days, items });
}
