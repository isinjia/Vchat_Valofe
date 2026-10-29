import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeAuthCode, fetchVfunUser } from "@/lib/vfun";
import { upsertVfunUser } from "@/lib/user";
import { setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// authcode 는 1회용 — 같은 코드의 중복 교환을 막는다 (HMR 에도 유지되도록 globalThis 캐시)
const g = globalThis as unknown as { __vfunUsedCodes?: Set<string> };
const used: Set<string> = (g.__vfunUsedCodes ??= new Set<string>());

function redirect(req: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, req.url), 303);
}

/** GET /auth?authcode= — vfun authcode 교환 후 세션 발급 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("authcode");
  if (!code) return redirect(req, "/login");

  if (used.has(code)) return redirect(req, "/login?error=used");
  used.add(code);
  // 메모리 무한 증가 방지
  if (used.size > 1000) used.delete(used.values().next().value as string);

  try {
    const token = await exchangeAuthCode(code);
    if (!token.ok || !token.accessToken) return redirect(req, "/login?error=auth");
    const vfunUser = await fetchVfunUser(token.accessToken);
    if (!vfunUser) return redirect(req, "/login?error=auth");
    const userId = await upsertVfunUser(vfunUser);
    setSessionCookie(await cookies(), userId);
    return redirect(req, "/");
  } catch {
    return redirect(req, "/login?error=auth");
  }
}
