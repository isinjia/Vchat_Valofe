import { NextRequest, NextResponse } from "next/server";
import { query, type SqlParam } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/** 유저 목록: 검색(q) + 페이징. 정렬 id DESC */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const offset = Math.max(0, Number(sp.get("offset") ?? "0") || 0);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") ?? "20") || 20));

  const where: string[] = [];
  const params: SqlParam[] = [];
  if (q) {
    // LIKE 와일드카드 이스케이프
    const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    where.push("(u.nickname LIKE ? OR u.username LIKE ? OR u.vfun_user_id LIKE ?)");
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [{ total }] = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
    params
  );
  const items = await query(
    `SELECT u.id, u.username, u.nickname, u.vfun_user_id, u.coins, u.status,
            u.tier_id, t.name AS tier_name, u.created_at
     FROM users u LEFT JOIN chat_tiers t ON t.id = u.tier_id
     ${whereSql}
     ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return NextResponse.json({ items, total: Number(total) });
}
