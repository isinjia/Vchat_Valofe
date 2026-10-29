import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppEnv, loginWithPassword, fetchVfunUser } from "@/lib/vfun";
import { upsertVfunUser } from "@/lib/user";
import { setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

/** POST /api/auth/login { username, password, otp? } — dev/stage 전용 id/pw 로그인 */
export async function POST(req: NextRequest) {
  if (getAppEnv() === "live") {
    return NextResponse.json({ error: "vfun 로그인 페이지를 이용하세요" }, { status: 403 });
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
    if (token.resultCode === 4057 || token.resultCode === 4059) {
      return NextResponse.json({ error: "해외/차단 IP — KMC 본인인증이 필요합니다" }, { status: 400 });
    }
    return NextResponse.json({ error: token.message || "로그인에 실패했습니다." }, { status: 400 });
  }

  const vfunUser = await fetchVfunUser(token.accessToken);
  if (!vfunUser) return NextResponse.json({ error: "유저 정보를 불러오지 못했습니다." }, { status: 400 });
  const userId = await upsertVfunUser(vfunUser);
  setSessionCookie(await cookies(), userId);
  return NextResponse.json({ ok: true });
}
