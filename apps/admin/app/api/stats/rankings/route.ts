import { NextRequest, NextResponse } from "next/server";
import { query, chatMessages } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/rankings?days=30 — 사용량 랭킹 (유저 메시지 기준)
 *   topUsers: 대화를 많이 한 유저 TOP 20 (vfun user id / no 로 표시)
 *   topCharacters: 대화를 많이 받은 캐릭터 TOP 20 (대화 유저 수 포함)
 *   topItems: 아이템 판매량 랭킹 TOP 20 (판매수/판매액)
 *   topGifted: 선물 받은 캐릭터 랭킹 TOP 20 (선물 금액 기준)
 */
export async function GET(req: NextRequest) {
  const daysRaw = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = Number.isInteger(daysRaw) ? Math.min(90, Math.max(7, daysRaw)) : 30;
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const col = await chatMessages();
  const [userAgg, charAgg] = await Promise.all([
    col
      .aggregate<{ _id: number; count: number }>([
        { $match: { role: "user", createdAt: { $gte: start } } },
        { $group: { _id: "$userId", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ])
      .toArray(),
    col
      .aggregate<{ _id: number; count: number; users: number }>([
        { $match: { role: "user", createdAt: { $gte: start } } },
        { $group: { _id: "$characterId", count: { $sum: 1 }, userSet: { $addToSet: "$userId" } } },
        { $project: { count: 1, users: { $size: "$userSet" } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ])
      .toArray(),
  ]);

  const userIds = userAgg.map((u) => Number(u._id)).filter(Number.isInteger);
  const charIds = charAgg.map((c) => Number(c._id)).filter(Number.isInteger);
  const [userRows, charRows] = await Promise.all([
    userIds.length
      ? query<{ id: number; nickname: string; vfun_user_id: string | null; vfun_u_no: number | null }>(
          `SELECT id, nickname, vfun_user_id, vfun_u_no FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
          userIds
        )
      : Promise.resolve([]),
    charIds.length
      ? query<{ id: number; name: string; world_name: string }>(
          `SELECT c.id, c.name, w.name AS world_name FROM characters c JOIN worlds w ON w.id = c.world_id
           WHERE c.id IN (${charIds.map(() => "?").join(",")})`,
          charIds
        )
      : Promise.resolve([]),
  ]);
  const userById = new Map(userRows.map((r) => [r.id, r]));
  const charById = new Map(charRows.map((r) => [r.id, r]));

  // 아이템 판매량 / 선물 받은 캐릭터 랭킹
  const [topItems, topGifted] = await Promise.all([
    query<{ item_name: string; world_name: string | null; cnt: number; sales: number }>(
      `SELECT u.item_name, w.name AS world_name, COUNT(*) AS cnt, SUM(u.price) AS sales
       FROM item_uses u LEFT JOIN worlds w ON w.id = u.world_id
       WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY u.item_name, w.name
       ORDER BY cnt DESC, sales DESC LIMIT 20`,
      [days]
    ),
    query<{ character_id: number; name: string | null; world_name: string | null; cnt: number; amount: number; users: number }>(
      `SELECT u.character_id, c.name, w.name AS world_name,
              COUNT(*) AS cnt, SUM(u.price) AS amount, COUNT(DISTINCT u.user_id) AS users
       FROM item_uses u
       LEFT JOIN characters c ON c.id = u.character_id
       LEFT JOIN worlds w ON w.id = u.world_id
       WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY u.character_id, c.name, w.name
       ORDER BY amount DESC LIMIT 20`,
      [days]
    ),
  ]);

  return NextResponse.json({
    topItems: topItems.map((r) => ({
      name: r.item_name,
      worldName: r.world_name ?? "-",
      count: Number(r.cnt),
      sales: Number(r.sales) || 0,
    })),
    topGifted: topGifted.map((r) => ({
      id: Number(r.character_id),
      name: r.name ?? "(삭제됨)",
      worldName: r.world_name ?? "-",
      count: Number(r.cnt),
      amount: Number(r.amount) || 0,
      users: Number(r.users),
    })),
    days,
    topUsers: userAgg.map((u) => {
      const r = userById.get(Number(u._id));
      return {
        id: Number(u._id),
        vfunUserId: r?.vfun_user_id ?? null,
        uNo: r?.vfun_u_no ?? null,
        nickname: r?.nickname ?? "(탈퇴/게스트)",
        messages: Number(u.count),
      };
    }),
    topCharacters: charAgg.map((c) => {
      const r = charById.get(Number(c._id));
      return {
        id: Number(c._id),
        name: r?.name ?? "(삭제됨)",
        worldName: r?.world_name ?? "-",
        messages: Number(c.count),
        users: Number(c.users),
      };
    }),
  });
}
