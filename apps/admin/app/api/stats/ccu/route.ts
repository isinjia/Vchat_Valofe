import { NextRequest, NextResponse } from "next/server";
import { chatMessages } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/ccu?hours=48 — 시간대별 활성 유저 (CCU 근사치, KST)
 * 세션 추적이 없으므로 "그 시간에 유저 메시지를 보낸 고유 유저 수" 로 근사한다.
 */
export async function GET(req: NextRequest) {
  const hoursRaw = Number(req.nextUrl.searchParams.get("hours") ?? 48);
  const hours = Number.isInteger(hoursRaw) ? Math.min(168, Math.max(12, hoursRaw)) : 48;
  const start = new Date(Date.now() - hours * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);

  const col = await chatMessages();
  const agg = await col
    .aggregate<{ _id: string; users: number; messages: number }>([
      { $match: { role: "user", createdAt: { $gte: start } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d %H시", date: "$createdAt", timezone: "+09:00" } },
          userSet: { $addToSet: "$userId" },
          messages: { $sum: 1 },
        },
      },
      { $project: { users: { $size: "$userSet" }, messages: 1 } },
    ])
    .toArray();
  const map = new Map(agg.map((r) => [r._id, r]));

  const items: { hour: string; users: number; messages: number }[] = [];
  for (let i = 0; i <= hours; i++) {
    const t = new Date(start.getTime() + i * 60 * 60 * 1000);
    if (t.getTime() > Date.now()) break;
    const kst = new Date(t.getTime() + 9 * 60 * 60 * 1000);
    const key = `${kst.toISOString().slice(0, 10)} ${String(kst.getUTCHours()).padStart(2, "0")}시`;
    const row = map.get(key);
    items.push({ hour: key, users: row?.users ?? 0, messages: row?.messages ?? 0 });
  }
  return NextResponse.json({ hours, items });
}
