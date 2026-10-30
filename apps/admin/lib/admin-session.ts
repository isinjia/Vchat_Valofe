import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env, query } from "@vchatbot/core";

/**
 * 관리툴 세션: base64url(JSON{uid,role,exp}).hmac
 * 쿠키 이름은 웹과 다르게 (localhost 에서 포트가 달라도 쿠키는 도메인 단위로 공유됨).
 * role 은 로그인 시점에 굳는다 — 권한 변경은 재로그인 후 반영.
 */
export const ADMIN_SESSION_COOKIE = "vc_admin_session";
const MAX_AGE_SEC = 60 * 60 * 12; // 12시간

export type AdminRole = "user_admin" | "system_admin";
export interface AdminSession {
  uid: number;
  role: AdminRole;
}

function secret(): string {
  return env("SESSION_SECRET", "dev-secret-change-me");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createAdminSession(uid: number, role: AdminRole): string {
  const payload = Buffer.from(
    JSON.stringify({ uid, role, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminSession(value: string | undefined | null): AdminSession | null {
  if (!value) return null;
  const idx = value.indexOf(".");
  if (idx <= 0) return null;
  const payload = value.slice(0, idx);
  const sig = Buffer.from(value.slice(idx + 1));
  const expected = Buffer.from(sign(payload));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const { uid, role, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isInteger(uid) || uid <= 0) return null;
    if (role !== "user_admin" && role !== "system_admin") return null;
    if (typeof exp !== "number" || exp < Math.floor(Date.now() / 1000)) return null;
    return { uid, role };
  } catch {
    return null;
  }
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export function setAdminSessionCookie(store: CookieStore, uid: number, role: AdminRole): void {
  store.set(ADMIN_SESSION_COOKIE, createAdminSession(uid, role), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export function clearAdminSessionCookie(store: CookieStore): void {
  store.delete(ADMIN_SESSION_COOKIE);
}

/** 현재 요청의 관리자 세션 (없으면 null) */
export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  return verifyAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
}

/** 세션 + 유저 표시 정보 (레이아웃용). vfun 닉네임은 변할 수 있어 user no / user id 를 함께 쓴다 */
export async function getAdminUser(): Promise<
  (AdminSession & { nickname: string; vfunUserId: string | null; uNo: number | null }) | null
> {
  const session = await getAdminSession();
  if (!session) return null;
  const rows = await query<{ nickname: string; vfun_user_id: string | null; vfun_u_no: number | null }>(
    "SELECT nickname, vfun_user_id, vfun_u_no FROM users WHERE id = ?",
    [session.uid]
  );
  if (rows.length === 0) return null;
  return {
    ...session,
    nickname: rows[0].nickname,
    vfunUserId: rows[0].vfun_user_id,
    uNo: rows[0].vfun_u_no,
  };
}
