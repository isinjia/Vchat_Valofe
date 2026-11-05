import { NextRequest, NextResponse } from "next/server";
import { chatMessages, query, execute } from "@vchatbot/core";
import { getAdminSession } from "../../../../lib/admin-session";

export const dynamic = "force-dynamic";

/** 유저 상세: 기본정보 + 코인 요약 + 최근 거래 + 채팅한 캐릭터(토큰 집계 병합) */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  }

  const users = await query(
    `SELECT u.id, u.username, u.nickname, u.vfun_user_id, u.coins, u.status,
            u.admin_role, u.personality_type,
            u.tier_id, t.name AS tier_name, u.creator_tier_id, u.ai_level_id, u.created_at
     FROM users u LEFT JOIN chat_tiers t ON t.id = u.tier_id
     WHERE u.id = ?`,
    [id]
  );
  if (!users.length) return NextResponse.json({ error: "유저 없음" }, { status: 404 });

  const [coinSummary, recentTransactions, chars, tokenAgg] = await Promise.all([
    query<{ type: string; count: number; total: number | null }>(
      `SELECT type, COUNT(*) AS count, SUM(amount) AS total
       FROM coin_transactions WHERE user_id = ? GROUP BY type`,
      [id]
    ),
    query(
      `SELECT id, type, amount, balance_after, ref_type, ref_id, memo, created_at
       FROM coin_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 30`,
      [id]
    ),
    query<{
      characterId: number;
      characterName: string;
      worldName: string | null;
      affinity: number;
      message_count: number;
      updated_at: string;
    }>(
      `SELECT s.character_id AS characterId, c.name AS characterName, w.name AS worldName,
              s.affinity, s.message_count, s.updated_at
       FROM user_character_state s
       JOIN characters c ON c.id = s.character_id
       LEFT JOIN worlds w ON w.id = c.world_id
       WHERE s.user_id = ? ORDER BY s.updated_at DESC`,
      [id]
    ),
    chatMessages().then((col) =>
      col
        .aggregate([
          { $match: { userId: id, role: "assistant", "meta.tokensIn": { $exists: true } } },
          {
            $group: {
              _id: "$characterId",
              totalIn: { $sum: { $ifNull: ["$meta.tokensIn", 0] } },
              totalOut: { $sum: { $ifNull: ["$meta.tokensOut", 0] } },
            },
          },
        ])
        .toArray()
    ),
  ]);

  const tokMap = new Map<number, { totalIn: number; totalOut: number }>();
  for (const t of tokenAgg) {
    tokMap.set(t._id as number, { totalIn: t.totalIn as number, totalOut: t.totalOut as number });
  }
  const characters = chars.map((c) => ({
    ...c,
    totalIn: tokMap.get(c.characterId)?.totalIn ?? 0,
    totalOut: tokMap.get(c.characterId)?.totalOut ?? 0,
  }));

  return NextResponse.json({
    user: users[0],
    coinSummary: coinSummary.map((r) => ({
      type: r.type,
      count: Number(r.count),
      total: Number(r.total ?? 0),
    })),
    recentTransactions,
    characters,
  });
}

/** 등급/상태 변경 (tier_id, creator_tier_id, ai_level_id, status 만 허용) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: (number | string)[] = [];

  if ("tier_id" in body) {
    if (body.tier_id === null) {
      sets.push("tier_id = NULL");
    } else {
      const tid = Number(body.tier_id);
      const found = Number.isInteger(tid)
        ? await query("SELECT id FROM chat_tiers WHERE id = ?", [tid])
        : [];
      if (!found.length) return NextResponse.json({ error: "존재하지 않는 등급" }, { status: 400 });
      sets.push("tier_id = ?");
      vals.push(tid);
    }
  }
  if ("creator_tier_id" in body) {
    if (body.creator_tier_id === null) {
      sets.push("creator_tier_id = NULL");
    } else {
      const cid = Number(body.creator_tier_id);
      const found = Number.isInteger(cid)
        ? await query("SELECT id FROM chat_tiers WHERE id = ? AND track = 'creator'", [cid])
        : [];
      if (!found.length) return NextResponse.json({ error: "존재하지 않는 크리에이터 등급" }, { status: 400 });
      sets.push("creator_tier_id = ?");
      vals.push(cid);
    }
  }
  if ("ai_level_id" in body) {
    if (body.ai_level_id === null) {
      sets.push("ai_level_id = NULL");
    } else {
      const lid = Number(body.ai_level_id);
      const found = Number.isInteger(lid)
        ? await query("SELECT id FROM ai_levels WHERE id = ?", [lid])
        : [];
      if (!found.length) return NextResponse.json({ error: "존재하지 않는 AI 레벨" }, { status: 400 });
      sets.push("ai_level_id = ?");
      vals.push(lid);
    }
  }
  if ("status" in body) {
    if (body.status !== "active" && body.status !== "banned") {
      return NextResponse.json({ error: "status 는 active/banned 만 가능" }, { status: 400 });
    }
    sets.push("status = ?");
    vals.push(body.status);
  }
  if ("admin_role" in body) {
    const role = body.admin_role;
    if (role !== null && role !== "user_admin" && role !== "system_admin") {
      return NextResponse.json({ error: "admin_role 은 null/user_admin/system_admin 만 가능" }, { status: 400 });
    }
    const session = await getAdminSession();
    if (session && session.uid === id && role !== "system_admin") {
      return NextResponse.json(
        { error: "자기 자신의 시스템 관리자 권한은 해제할 수 없습니다." },
        { status: 400 }
      );
    }
    if (role === null) {
      sets.push("admin_role = NULL");
    } else {
      sets.push("admin_role = ?");
      vals.push(role);
    }
  }
  if (!sets.length) return NextResponse.json({ error: "변경할 값 없음" }, { status: 400 });

  const ex = await query("SELECT id FROM users WHERE id = ?", [id]);
  if (!ex.length) return NextResponse.json({ error: "유저 없음" }, { status: 404 });
  await execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
  return NextResponse.json({ ok: true });
}
