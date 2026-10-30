import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@vchatbot/core";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

interface AdminRow {
  id: number;
  vfun_user_id: string | null;
  vfun_u_no: number | null;
  nickname: string;
  admin_role: "user_admin" | "system_admin";
  block_count: number;
  active_id: number | null;
  active_ends_at: string | null;
  active_reason: string | null;
}

/** GET — 관리자 목록 (활성 admin_block 1건 + 누적 횟수) + me(현재 로그인 uid) */
export async function GET() {
  const session = await getAdminSession();
  const rows = await query<AdminRow>(
    `SELECT u.id, u.vfun_user_id, u.vfun_u_no, u.nickname, u.admin_role,
            (SELECT COUNT(*) FROM sanctions s
              WHERE s.target_type = 'user' AND s.target_id = u.id AND s.kind = 'admin_block') AS block_count,
            a.id AS active_id, a.ends_at AS active_ends_at, a.reason AS active_reason
     FROM users u
     LEFT JOIN sanctions a ON a.id = (
       SELECT s2.id FROM sanctions s2
        WHERE s2.target_type = 'user' AND s2.target_id = u.id AND s2.kind = 'admin_block'
          AND s2.revoked_at IS NULL AND s2.ends_at > NOW()
        ORDER BY s2.ends_at DESC LIMIT 1)
     WHERE u.admin_role IS NOT NULL
     ORDER BY u.admin_role DESC, u.id ASC`
  );
  return NextResponse.json({
    me: session?.uid ?? null,
    admins: rows.map((r) => ({
      id: r.id,
      vfun_user_id: r.vfun_user_id,
      vfun_u_no: r.vfun_u_no,
      nickname: r.nickname,
      admin_role: r.admin_role,
      block_count: Number(r.block_count) || 0,
      active_block: r.active_id
        ? { id: r.active_id, ends_at: r.active_ends_at, reason: r.active_reason }
        : null,
    })),
  });
}

/** POST { vfunUserId, role } — vfun 로그인 이력이 있는 계정을 관리자로 지정 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const vfunUserId = typeof b.vfunUserId === "string" ? b.vfunUserId.trim() : "";
  const role = b.role;
  if (!vfunUserId) return NextResponse.json({ error: "vfun 아이디를 입력하세요." }, { status: 400 });
  if (role !== "user_admin" && role !== "system_admin") {
    return NextResponse.json({ error: "role 은 user_admin/system_admin 만 가능합니다." }, { status: 400 });
  }
  const found = await query<{ id: number }>("SELECT id FROM users WHERE vfun_user_id = ?", [vfunUserId]);
  if (!found.length) {
    return NextResponse.json(
      {
        error:
          "해당 vfun 아이디로 로그인한 적 있는 계정이 없습니다. (서비스 또는 관리툴에 한 번 이상 vfun 로그인 필요)",
      },
      { status: 404 }
    );
  }
  await execute("UPDATE users SET admin_role = ? WHERE id = ?", [role, found[0].id]);
  return NextResponse.json({ ok: true, id: found[0].id });
}
