import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/**
 * 관리자 로그 조회 (시스템 관리자 전용 — 미들웨어에서 차단).
 * ?distinctAdmins=1 → 로그가 있는 관리자 목록 (필터 드롭다운용)
 * ?adminId=&q=&offset=0&limit=50 → { items, total }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  if (sp.get("distinctAdmins")) {
    const admins = await query(
      `SELECT DISTINCT l.admin_user_id AS id, u.vfun_user_id, u.vfun_u_no
       FROM admin_logs l JOIN users u ON u.id = l.admin_user_id
       ORDER BY l.admin_user_id`
    );
    return NextResponse.json({ admins });
  }

  const offset = Math.max(0, Number(sp.get("offset") ?? "0") || 0);
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit") ?? "50") || 50));
  const where: string[] = [];
  const params: (string | number)[] = [];

  const adminId = Number(sp.get("adminId"));
  if (Number.isInteger(adminId) && adminId > 0) {
    where.push("l.admin_user_id = ?");
    params.push(adminId);
  }
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    where.push("l.path LIKE ?");
    params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [{ total }] = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM admin_logs l JOIN users u ON u.id = l.admin_user_id ${whereSql}`,
    params
  );
  const items = await query(
    `SELECT l.*, u.vfun_user_id, u.vfun_u_no, u.nickname
     FROM admin_logs l JOIN users u ON u.id = l.admin_user_id
     ${whereSql}
     ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return NextResponse.json({ items, total: Number(total) });
}
