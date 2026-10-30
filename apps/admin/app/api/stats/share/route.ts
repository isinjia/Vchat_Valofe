import { NextRequest, NextResponse } from "next/server";
import { query, chatMessages } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/share?days=30 — 최근 N일 유저 메시지 기준 세계관/캐릭터 점유율
 * 응답: { total, worlds: [{id, name, count}], characters: [{id, name, worldName, count}] }
 * (삭제된 캐릭터의 메시지는 '(삭제됨)' 으로 묶인다)
 */
export async function GET(req: NextRequest) {
  const daysRaw = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = Number.isInteger(daysRaw) ? Math.min(90, Math.max(7, daysRaw)) : 30;
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const col = await chatMessages();
  const agg = await col
    .aggregate<{ _id: number; count: number }>([
      { $match: { role: "user", createdAt: { $gte: start } } },
      { $group: { _id: "$characterId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  if (agg.length === 0) return NextResponse.json({ total: 0, worlds: [], characters: [] });

  const ids = agg.map((a) => Number(a._id)).filter((n) => Number.isInteger(n));
  const rows = ids.length
    ? await query<{ id: number; name: string; world_id: number; world_name: string }>(
        `SELECT c.id, c.name, c.world_id, w.name AS world_name
         FROM characters c JOIN worlds w ON w.id = c.world_id
         WHERE c.id IN (${ids.map(() => "?").join(",")})`,
        ids
      )
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  let total = 0;
  const worldMap = new Map<string, { id: number | null; name: string; count: number }>();
  const characters: { id: number; name: string; worldName: string; count: number }[] = [];
  for (const a of agg) {
    const count = Number(a.count);
    total += count;
    const c = byId.get(Number(a._id));
    const worldKey = c ? `w${c.world_id}` : "deleted";
    const w = worldMap.get(worldKey) ?? { id: c?.world_id ?? null, name: c?.world_name ?? "(삭제됨)", count: 0 };
    w.count += count;
    worldMap.set(worldKey, w);
    characters.push({
      id: Number(a._id),
      name: c?.name ?? "(삭제됨)",
      worldName: c?.world_name ?? "-",
      count,
    });
  }
  const worlds = [...worldMap.values()].sort((a, b) => b.count - a.count);
  return NextResponse.json({ total, worlds, characters });
}
