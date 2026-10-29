import { NextRequest, NextResponse } from "next/server";
import { chatMessages, query, cached } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/**
 * 사용량 통계: assistant 메시지 중 meta.tokensIn 이 기록된 것만 집계 (days=0 이면 전체).
 * Redis 5분 lazy 캐시 — 만료 후 첫 요청이 재집계. 실시간성이 필요 없는 화면이라 능동 무효화 없음.
 */
export async function GET(req: NextRequest) {
  const days = Math.max(0, Number(req.nextUrl.searchParams.get("days") ?? "7") || 0);
  const data = await cached(`cache:admin:stats:${days}`, 300, () => buildStats(days));
  return NextResponse.json(data);
}

async function buildStats(days: number) {
  const col = await chatMessages();

  const match: Record<string, unknown> = {
    role: "assistant",
    "meta.tokensIn": { $exists: true },
  };
  if (days > 0) match.createdAt = { $gte: new Date(Date.now() - days * 86400_000) };

  const [overallAgg, maxInDoc, maxOutDoc, userAgg, modelAgg] = await Promise.all([
    col
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            messages: { $sum: 1 },
            totalIn: { $sum: { $ifNull: ["$meta.tokensIn", 0] } },
            totalOut: { $sum: { $ifNull: ["$meta.tokensOut", 0] } },
            cacheRead: { $sum: { $ifNull: ["$meta.tokensCacheRead", 0] } },
          },
        },
      ])
      .toArray(),
    col.find(match).sort({ "meta.tokensIn": -1 }).limit(1).toArray(),
    col
      .find({ ...match, "meta.tokensOut": { $exists: true } })
      .sort({ "meta.tokensOut": -1 })
      .limit(1)
      .toArray(),
    col
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: "$userId",
            messages: { $sum: 1 },
            totalIn: { $sum: { $ifNull: ["$meta.tokensIn", 0] } },
            totalOut: { $sum: { $ifNull: ["$meta.tokensOut", 0] } },
            maxIn: { $max: "$meta.tokensIn" },
            maxOut: { $max: "$meta.tokensOut" },
          },
        },
        { $addFields: { total: { $add: ["$totalIn", "$totalOut"] } } },
        { $sort: { total: -1 } },
        { $limit: 20 },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: "$meta.model",
            messages: { $sum: 1 },
            totalIn: { $sum: { $ifNull: ["$meta.tokensIn", 0] } },
            totalOut: { $sum: { $ifNull: ["$meta.tokensOut", 0] } },
          },
        },
        { $sort: { messages: -1 } },
      ])
      .toArray(),
  ]);

  // MySQL 에서 닉네임/캐릭터명 조인
  const userIds = new Set<number>();
  const charIds = new Set<number>();
  for (const d of [maxInDoc[0], maxOutDoc[0]]) {
    if (d) {
      userIds.add(d.userId);
      charIds.add(d.characterId);
    }
  }
  for (const u of userAgg) userIds.add(u._id as number);

  const nickMap = new Map<number, string>();
  const charMap = new Map<number, string>();
  if (userIds.size) {
    const ids = [...userIds];
    const rows = await query<{ id: number; nickname: string | null }>(
      `SELECT id, nickname FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    for (const r of rows) if (r.nickname) nickMap.set(r.id, r.nickname);
  }
  if (charIds.size) {
    const ids = [...charIds];
    const rows = await query<{ id: number; name: string }>(
      `SELECT id, name FROM characters WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    for (const r of rows) charMap.set(r.id, r.name);
  }

  const o = overallAgg[0];
  const messages = (o?.messages as number) ?? 0;
  const totalIn = (o?.totalIn as number) ?? 0;
  const totalOut = (o?.totalOut as number) ?? 0;

  const maxItem = (d: (typeof maxInDoc)[number] | undefined, key: "tokensIn" | "tokensOut") =>
    d
      ? {
          [key]: Number((d.meta as Record<string, unknown>)?.[key] ?? 0),
          userId: d.userId,
          userName: nickMap.get(d.userId) ?? null,
          characterId: d.characterId,
          characterName: charMap.get(d.characterId) ?? null,
          createdAt: d.createdAt,
        }
      : null;

  return {
    overall: {
      messages,
      totalIn,
      totalOut,
      avgIn: messages ? Math.round(totalIn / messages) : 0,
      avgOut: messages ? Math.round(totalOut / messages) : 0,
      cacheRead: (o?.cacheRead as number) ?? 0,
    },
    max: {
      input: maxItem(maxInDoc[0], "tokensIn"),
      output: maxItem(maxOutDoc[0], "tokensOut"),
    },
    topUsers: userAgg.map((u) => ({
      userId: u._id as number,
      nickname: nickMap.get(u._id as number) ?? null,
      messages: u.messages as number,
      totalIn: u.totalIn as number,
      totalOut: u.totalOut as number,
      avgIn: Math.round((u.totalIn as number) / (u.messages as number)),
      avgOut: Math.round((u.totalOut as number) / (u.messages as number)),
      maxIn: (u.maxIn as number) ?? 0,
      maxOut: (u.maxOut as number) ?? 0,
    })),
    byModel: modelAgg.map((m) => ({
      model: (m._id as string) ?? "(미상)",
      messages: m.messages as number,
      totalIn: m.totalIn as number,
      totalOut: m.totalOut as number,
    })),
  };
}
