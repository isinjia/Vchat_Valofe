import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { buildUserWhere } from "./filters";

export const dynamic = "force-dynamic";

/** 유저 목록: 검색(q) + 페이징. 정렬 id DESC */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const offset = Math.max(0, Number(sp.get("offset") ?? "0") || 0);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") ?? "20") || 20));
  const { whereSql, params } = buildUserWhere(sp);

  const [{ total }] = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
    params
  );
  const items = await query(
    `SELECT u.id, u.username, u.nickname, u.vfun_user_id, u.coins, u.status,
            u.tier_id, t.name AS tier_name, u.created_at,
            (SELECT COUNT(*) FROM sanctions s
             WHERE s.target_type = 'user' AND s.target_id = u.id) AS sanction_count,
            (SELECT COUNT(*) FROM sanctions s
             WHERE s.target_type = 'user' AND s.target_id = u.id
               AND s.revoked_at IS NULL AND s.ends_at > NOW()) AS active_sanction_count
     FROM users u LEFT JOIN chat_tiers t ON t.id = u.tier_id
     ${whereSql}
     ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return NextResponse.json({ items, total: Number(total) });
}
