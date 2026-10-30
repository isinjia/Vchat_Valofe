import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query, execute } from "@vchatbot/core";
import { getAppEnv, loginWithPassword, fetchVfunUser, type VfunUser } from "@/lib/vfun";
import { setAdminSessionCookie, type AdminRole } from "@/lib/admin-session";

export const runtime = "nodejs";

/** vfun 유저 upsert — users.id = vfun u_no 로 통일 (웹과 동일 규칙). 닉네임은 로그인 시 갱신 */
async function upsertVfunUser(u: VfunUser): Promise<number> {
  const rows = await query<{ id: number }>("SELECT id FROM users WHERE vfun_u_no = ?", [u.uNo]);
  if (rows.length > 0) {
    await execute("UPDATE users SET nickname = ?, profile_image = ?, vfun_user_id = ? WHERE id = ?", [
      u.nickname,
      u.profileImage,
      u.userId || null,
      rows[0].id,
    ]);
    return rows[0].id;
  }
  await execute(
    "INSERT INTO users (id, username, nickname, vfun_u_no, vfun_user_id, profile_image) VALUES (?, ?, ?, ?, ?, ?)",
    [u.uNo, `vfun_${u.uNo}`, u.nickname, u.uNo, u.userId || null, u.profileImage]
  );
  return u.uNo;
}

/** POST { username, password, otp? } — vfun id/pw 로그인 + 관리자 권한 확인 */
export async function POST(req: NextRequest) {
  if (getAppEnv() === "live") {
    return NextResponse.json({ error: "live 환경 관리툴 로그인은 통합 관리자 인증 도입 후 지원됩니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const otp = typeof body?.otp === "string" && body.otp ? body.otp.trim() : undefined;
  if (!username || (!password && !otp)) {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력하세요." }, { status: 400 });
  }

  const token = await loginWithPassword(username, password, otp);
  if (!token.ok || !token.accessToken) {
    if (token.resultCode === 4073) return NextResponse.json({ otpRequired: true });
    return NextResponse.json({ error: token.message || "로그인에 실패했습니다." }, { status: 400 });
  }
  const vfunUser = await fetchVfunUser(token.accessToken);
  if (!vfunUser) return NextResponse.json({ error: "유저 정보를 불러오지 못했습니다." }, { status: 400 });

  const userId = await upsertVfunUser(vfunUser);
  const roleRows = await query<{ admin_role: AdminRole | null }>(
    "SELECT admin_role FROM users WHERE id = ?",
    [userId]
  );
  const role = roleRows[0]?.admin_role ?? null;
  if (!role) {
    return NextResponse.json({ error: "관리자 권한이 없는 계정입니다." }, { status: 403 });
  }
  // 관리권한 일시 정지 중이면 로그인 거부 (기존 세션은 만료(최대 12시간)까지 유효)
  const blocked = await query<{ ends_at: string; reason: string | null }>(
    `SELECT ends_at, reason FROM sanctions
     WHERE target_type = 'user' AND target_id = ? AND kind = 'admin_block'
       AND revoked_at IS NULL AND ends_at > NOW()
     ORDER BY ends_at DESC LIMIT 1`,
    [userId]
  );
  if (blocked.length > 0) {
    const until = new Date(blocked[0].ends_at).toLocaleString("ko-KR");
    return NextResponse.json(
      { error: `관리 권한이 일시 정지된 계정입니다. ${until} 까지${blocked[0].reason ? ` (사유: ${blocked[0].reason})` : ""}` },
      { status: 403 }
    );
  }

  setAdminSessionCookie(await cookies(), userId, role);
  // 로그인도 감사 로그에 남긴다 (미들웨어는 /api/auth/login 을 공개 경로로 두므로 직접 기록)
  await execute("INSERT INTO admin_logs (admin_user_id, method, path, detail) VALUES (?, 'POST', '/login', ?)", [
    userId,
    JSON.stringify({ action: "login", role }),
  ]);
  return NextResponse.json({ ok: true, role });
}
