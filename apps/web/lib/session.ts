import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@vchatbot/core";

export const SESSION_COOKIE = "vc_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30일

function sign(payload: string): string {
  return createHmac("sha256", env("SESSION_SECRET", "dev-secret-change-me")).update(payload).digest("base64url");
}

/** 세션 쿠키 값 생성: base64url(JSON{uid,exp}).hmac */
export function createSession(userId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** 서명/만료 검증 후 userId 반환 (실패 시 null) */
export function verifySession(value: string | undefined | null): number | null {
  if (!value) return null;
  const idx = value.indexOf(".");
  if (idx <= 0) return null;
  const payload = value.slice(0, idx);
  const sig = Buffer.from(value.slice(idx + 1));
  const expected = Buffer.from(sign(payload));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isInteger(uid) || uid <= 0) return null;
    if (typeof exp !== "number" || exp < Math.floor(Date.now() / 1000)) return null;
    return uid;
  } catch {
    return null;
  }
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export function setSessionCookie(store: CookieStore, userId: number): void {
  store.set(SESSION_COOKIE, createSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    // https 가 아닌 환경에서만 INSECURE_COOKIES=1 로 Secure 를 끈다 (기본은 Secure)
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function getSessionUserId(): Promise<number | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}
