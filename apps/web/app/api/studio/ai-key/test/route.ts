import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { query } from "@vchatbot/core";
import { requireUser, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { apiKey? } — Claude API 키 유효성 테스트.
 * apiKey 를 주면 그 키(등록 전 검증), 없으면 등록된 키를 확인한다.
 * 모델 목록 조회라 토큰 소모 없이 인증만 확인된다.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const body = await req.json().catch(() => ({}));
  let apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    const rows = await query<{ claude_api_key: string | null }>(
      "SELECT claude_api_key FROM users WHERE id = ?",
      [auth.userId]
    );
    apiKey = rows[0]?.claude_api_key || "";
  }
  if (!apiKey) return bad("테스트할 키가 없습니다.");
  try {
    await new Anthropic({ apiKey }).models.list({ limit: 1 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const detail =
      err instanceof Anthropic.APIError
        ? err.status === 401
          ? "인증 실패 — 키가 올바르지 않거나 비활성화되었습니다."
          : `(${err.status}) ${err.message}`
        : ((err as Error).message ?? "알 수 없는 오류");
    return NextResponse.json({ ok: false, error: detail });
  }
}
