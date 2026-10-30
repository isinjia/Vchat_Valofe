import { NextRequest, NextResponse } from "next/server";
import { sweepScheduledDeletions } from "@vchatbot/core";
import { query, execute, type SqlParam } from "@vchatbot/core";

/** 목록 필터: q(이름), visibility(open|private), status(active|suspended), owner(admin|user) */
export async function GET(req: NextRequest) {
  // 만기 지난 삭제 대기 건 정리 (lazy sweep)
  await sweepScheduledDeletions();
  const sp = req.nextUrl.searchParams;
  const where: string[] = [];
  const params: SqlParam[] = [];
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    where.push("w.name LIKE ?");
    params.push(`%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  }
  const visibility = sp.get("visibility");
  if (visibility === "open" || visibility === "private") {
    where.push("w.visibility = ?");
    params.push(visibility);
  }
  const status = sp.get("status");
  if (status === "active" || status === "suspended") {
    where.push("w.status = ?");
    params.push(status);
  }
  const owner = sp.get("owner");
  if (owner === "admin") where.push("w.owner_user_id IS NULL");
  else if (owner === "user") where.push("w.owner_user_id IS NOT NULL");
  // 삭제 대기 상태 필터
  if (sp.get("state") === "delete_pending") where.push("w.delete_scheduled_at IS NOT NULL");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // limit 파라미터가 있으면 페이징 응답 {items, total}, 없으면 기존 배열 (셀렉트 박스 등 호환)
  const limitRaw = sp.get("limit");
  if (limitRaw != null) {
    const limit = Math.min(100, Math.max(1, Number(limitRaw) || 20));
    const offset = Math.max(0, Number(sp.get("offset")) || 0);
    const [{ total }] = await query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM worlds w ${whereSql}`,
      params
    );
    const items = await query(
      `SELECT w.*, u.nickname AS owner_nickname, u.vfun_user_id AS owner_vfun_id, u.vfun_u_no AS owner_u_no,
              (SELECT COUNT(*) FROM characters c WHERE c.world_id = w.id) AS character_count
       FROM worlds w LEFT JOIN users u ON u.id = w.owner_user_id ${whereSql}
       ORDER BY w.id DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    return NextResponse.json({ items, total: Number(total) });
  }
  const worlds = await query(
    `SELECT w.*, u.nickname AS owner_nickname, u.vfun_user_id AS owner_vfun_id, u.vfun_u_no AS owner_u_no,
            (SELECT COUNT(*) FROM characters c WHERE c.world_id = w.id) AS character_count
     FROM worlds w LEFT JOIN users u ON u.id = w.owner_user_id ${whereSql} ORDER BY w.id DESC`,
    params
  );
  return NextResponse.json(worlds);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description = "", ai_prompt = "" } = body;
  if (!name) return NextResponse.json({ error: "name 은 필수입니다." }, { status: 400 });
  const result = await execute(
    "INSERT INTO worlds (name, description, ai_prompt) VALUES (?, ?, ?)",
    [name, description, ai_prompt]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
