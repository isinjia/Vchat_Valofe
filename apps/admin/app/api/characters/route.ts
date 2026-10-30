import { NextRequest, NextResponse } from "next/server";
import { query, execute, sweepScheduledDeletions, type SqlParam } from "@vchatbot/core";

/** 목록 필터: q(이름), worldId, visibility(open|private), status(active|suspended), owner(admin|user) */
export async function GET(req: NextRequest) {
  // 만기 지난 삭제 대기 건 정리 (lazy sweep)
  await sweepScheduledDeletions();
  const sp = req.nextUrl.searchParams;
  const where: string[] = [];
  const params: SqlParam[] = [];
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    where.push("c.name LIKE ?");
    params.push(`%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  }
  const worldId = sp.get("worldId");
  if (worldId) {
    where.push("c.world_id = ?");
    params.push(worldId);
  }
  const visibility = sp.get("visibility");
  if (visibility === "open" || visibility === "private") {
    where.push("c.visibility = ?");
    params.push(visibility);
  }
  const status = sp.get("status");
  if (status === "active" || status === "suspended") {
    where.push("c.status = ?");
    params.push(status);
  }
  const owner = sp.get("owner");
  if (owner === "admin") where.push("c.owner_user_id IS NULL");
  else if (owner === "user") where.push("c.owner_user_id IS NOT NULL");
  // 제재/삭제 대기 상태 필터
  const state = sp.get("state");
  if (state === "sanctioned") {
    where.push(`EXISTS (SELECT 1 FROM sanctions s2
      WHERE s2.target_type = 'character' AND s2.target_id = c.id AND s2.kind = 'hide'
        AND s2.revoked_at IS NULL AND s2.ends_at > NOW())`);
  } else if (state === "delete_pending") {
    where.push("c.delete_scheduled_at IS NOT NULL");
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT c.*, w.name AS world_name, u.nickname AS owner_nickname,
           u.vfun_user_id AS owner_vfun_id, u.vfun_u_no AS owner_u_no,
           (SELECT COUNT(*) FROM user_character_state s WHERE s.character_id = c.id) AS user_count
    FROM characters c JOIN worlds w ON w.id = c.world_id
    LEFT JOIN users u ON u.id = c.owner_user_id
    ${whereSql}
    ORDER BY c.id DESC`;
  const rows = await query(sql, params);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const {
    world_id,
    name,
    profile = "",
    personality = "",
    speech_style = "",
    ai_prompt = "",
  } = await req.json();
  if (!world_id || !name) {
    return NextResponse.json({ error: "world_id, name 은 필수입니다." }, { status: 400 });
  }
  // 세계관 내 캐릭터명 중복 검사
  const dup = await query("SELECT id FROM characters WHERE world_id = ? AND name = ? LIMIT 1", [world_id, name]);
  if (dup.length > 0) return NextResponse.json({ error: "이 세계관에 같은 이름의 캐릭터가 이미 있습니다." }, { status: 400 });
  try {
    const result = await execute(
      `INSERT INTO characters (world_id, name, profile, personality, speech_style, ai_prompt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [world_id, name, profile, personality, speech_style, ai_prompt]
    );
    return NextResponse.json({ id: result.insertId }, { status: 201 });
  } catch (e) {
    // UNIQUE 제약 위반 (동시 요청 레이스 대비)
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "이 세계관에 같은 이름의 캐릭터가 이미 있습니다." }, { status: 400 });
    throw e;
  }
}
