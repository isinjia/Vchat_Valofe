import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";

/**
 * 관리툴 전역 인증 미들웨어 (edge).
 * - 로그인 없이는 모든 페이지/API 접근 불가 (/login, /api/auth/login 제외)
 * - user_admin: 대시보드/조회 + 제재만. 시스템 메뉴와 그 외 변경 요청은 403
 * - 변경 요청(비 GET)은 /api/admin-log 로 감사 로그 전달 (요청 본문 발췌 포함)
 * 세션 검증은 admin-session.ts 와 같은 HMAC 포맷을 Web Crypto 로 수행한다.
 */

const COOKIE = "vc_admin_session";

const PUBLIC = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/admin-log$/, /^\/_next\//, /^\/favicon/];

/** user_admin 이 접근할 수 없는 경로 (시스템 관리 영역) */
const SYSTEM_ONLY = [
  "/tiers",
  "/ai-levels",
  "/llm",
  "/settings",
  "/presets",
  "/logs",
  "/api/tiers",
  "/api/ai-levels",
  "/api/llm",
  "/api/settings",
  "/api/anniversary-presets",
  "/api/image-providers",
  "/api/logs",
  "/admins",
  "/api/admins",
];

/** user_admin 에게 허용되는 변경(비 GET) API */
const USER_ADMIN_WRITE_ALLOW = ["/api/sanctions", "/api/auth/logout"];

interface SessionPayload {
  uid: number;
  role: "user_admin" | "system_admin";
  exp: number;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(buf: ArrayBuffer): string {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verify(value: string | undefined): Promise<SessionPayload | null> {
  if (!value) return null;
  const idx = value.indexOf(".");
  if (idx <= 0) return null;
  const payload = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret-change-me"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    if (bytesToB64url(mac) !== sig) return null;
    const json = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as SessionPayload;
    if (!Number.isInteger(json.uid) || json.uid <= 0) return null;
    if (json.role !== "user_admin" && json.role !== "system_admin") return null;
    if (typeof json.exp !== "number" || json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  const session = await verify(req.cookies.get(COOKIE)?.value);
  const isApi = pathname.startsWith("/api");
  if (!session) {
    if (isApi) return NextResponse.json({ error: "login_required" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (session.role !== "system_admin") {
    if (SYSTEM_ONLY.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      if (isApi) return NextResponse.json({ error: "시스템 관리자 전용입니다." }, { status: 403 });
      const url = req.nextUrl.clone();
      url.pathname = "/stats";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (isApi && req.method !== "GET" && !USER_ADMIN_WRITE_ALLOW.some((p) => pathname.startsWith(p))) {
      return NextResponse.json({ error: "시스템 관리자 전용 작업입니다." }, { status: 403 });
    }
  }

  // 감사 로그: 변경 요청만 (GET 조회는 제외)
  if (isApi && req.method !== "GET") {
    let detail = "";
    try {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) detail = (await req.clone().text()).slice(0, 1000);
    } catch {
      // 본문 없는 요청 등은 무시
    }
    event.waitUntil(
      fetch(new URL("/api/admin-log", req.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": process.env.SESSION_SECRET || "dev-secret-change-me",
        },
        body: JSON.stringify({ uid: session.uid, method: req.method, path: pathname, detail }),
      }).catch(() => {})
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
