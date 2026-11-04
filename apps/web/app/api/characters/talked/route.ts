import { NextRequest, NextResponse } from "next/server";
import { query, chatMessages } from "@vchatbot/core";
import { getUserId, isAdultUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/** GET /api/characters/talked?worldId= — 내가 최근 대화한 캐릭터 (최근 대화순, 최대 20) */
export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json([]);

  const col = await chatMessages();
  const groups = await col
    .aggregate<{ _id: number; lastAt: Date }>([
      { $match: { userId } },
      { $group: { _id: "$characterId", lastAt: { $max: "$createdAt" } } },
      { $sort: { lastAt: -1 } },
      { $limit: 20 },
    ])
    .toArray();
  const ids = groups.map((g) => Number(g._id)).filter((n) => Number.isInteger(n));
  if (ids.length === 0) return NextResponse.json([]);

  const where = [`c.id IN (${ids.map(() => "?").join(",")})`, "c.is_active = 1",
    "w.is_active = 1",
    "c.visibility = 'open'",
    "c.status = 'active'",
    "w.visibility = 'open'",
    "w.status = 'active'",
    "c.delete_scheduled_at IS NULL",
    "w.delete_scheduled_at IS NULL",
    `NOT EXISTS (SELECT 1 FROM sanctions s
       WHERE s.target_type = 'character' AND s.target_id = c.id AND s.kind = 'hide'
         AND s.revoked_at IS NULL AND s.ends_at > NOW())`,
  ];
  // 19금 캐릭터/세계관: 성인 확인된 유저에게만 노출
  const adultViewer = await isAdultUser(userId);
  if (!adultViewer) {
    where.push("c.is_adult = 0", "w.is_adult = 0");
  }
  const params: (string | number)[] = [...ids];
  const worldIdRaw = req.nextUrl.searchParams.get("worldId");
  if (worldIdRaw) {
    const worldId = Number(worldIdRaw);
    if (!Number.isInteger(worldId)) {
      return NextResponse.json({ error: "worldId 가 올바르지 않습니다." }, { status: 400 });
    }
    where.push("c.world_id = ?");
    params.push(worldId);
  }

  const rows = await query<{ id: number } & Record<string, unknown>>(
    `SELECT c.id, c.name, c.world_id, w.name AS world_name, COALESCE(c.title_color, w.title_color) AS title_color, c.title_image_url, c.like_count,
            (c.is_adult = 1 OR w.is_adult = 1) AS is_adult,
            uo.nickname AS owner_name,
            (SELECT url FROM illustrations i
             WHERE i.character_id = c.id AND i.kind = 'basic'
             ORDER BY i.sort_order, i.id LIMIT 1) AS thumb
     FROM characters c
     JOIN worlds w ON w.id = c.world_id
     LEFT JOIN users uo ON uo.id = c.owner_user_id
     WHERE ${where.join(" AND ")}`,
    params
  );
  // Mongo 의 최근 대화순 유지
  const byId = new Map(rows.map((r) => [r.id, r]));
  return NextResponse.json(ids.map((id) => byId.get(id)).filter(Boolean));
}
