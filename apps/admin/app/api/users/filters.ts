import type { SqlParam } from "@vchatbot/core";

/** 유저 목록/내보내기 공용 필터: q, status, tierId, creatorTierId (creatorTierId=none → 크리에이터 등급 없음) */
export function buildUserWhere(sp: URLSearchParams): { whereSql: string; params: SqlParam[] } {
  const where: string[] = [];
  const params: SqlParam[] = [];

  const q = (sp.get("q") ?? "").trim();
  if (q) {
    // LIKE 와일드카드 이스케이프
    const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    where.push("(u.nickname LIKE ? OR u.username LIKE ? OR u.vfun_user_id LIKE ?)");
    params.push(like, like, like);
  }

  const status = sp.get("status");
  if (status === "active" || status === "banned") {
    where.push("u.status = ?");
    params.push(status);
  }

  const tierId = Number(sp.get("tierId"));
  if (Number.isInteger(tierId) && tierId > 0) {
    where.push("u.tier_id = ?");
    params.push(tierId);
  }

  const ctRaw = sp.get("creatorTierId");
  if (ctRaw === "none") {
    where.push("u.creator_tier_id IS NULL");
  } else {
    const ct = Number(ctRaw);
    if (Number.isInteger(ct) && ct > 0) {
      where.push("u.creator_tier_id = ?");
      params.push(ct);
    }
  }

  // 제재 상태: 활성 제재(모든/신규 채팅 금지)가 있는 유저만
  if (sp.get("sanction") === "active") {
    where.push(`EXISTS (SELECT 1 FROM sanctions s
      WHERE s.target_type = 'user' AND s.target_id = u.id
        AND s.revoked_at IS NULL AND s.ends_at > NOW())`);
  }

  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}
