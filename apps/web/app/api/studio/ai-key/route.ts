import { NextRequest, NextResponse } from "next/server";
import { query, execute, getPricingSettings } from "@vchatbot/core";
import { requireUser, bad } from "@/lib/studio";

export const dynamic = "force-dynamic";

/** 현재 상태 응답 (키 원문은 포함하지 않는다) */
async function state(userId: number) {
  const [rows, pricing] = await Promise.all([
    query<{ claude_api_key: string | null }>("SELECT claude_api_key FROM users WHERE id = ?", [userId]),
    getPricingSettings(),
  ]);
  const key = rows[0]?.claude_api_key || "";
  return {
    hasKey: !!key,
    masked: key ? `****${key.slice(-4)}` : null,
    byokEnabled: !!pricing.byok?.enabled,
    byokCost: pricing.byok?.cost ?? 0,
  };
}

/** GET: 내 Claude 키 등록 여부(마스킹) + BYOK 허용/비용 */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  return NextResponse.json(await state(auth.userId));
}

/** PUT { apiKey }: 내 Claude 키 등록/교체 */
export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const body = await req.json().catch(() => ({}));
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey.startsWith("sk-ant-") || apiKey.length < 20 || apiKey.length > 255) {
    return bad("올바른 Claude API 키 형식이 아닙니다.");
  }
  await execute("UPDATE users SET claude_api_key = ? WHERE id = ?", [apiKey, auth.userId]);
  return NextResponse.json(await state(auth.userId));
}

/** DELETE: 내 Claude 키 삭제 */
export async function DELETE() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  await execute("UPDATE users SET claude_api_key = NULL WHERE id = ?", [auth.userId]);
  return NextResponse.json(await state(auth.userId));
}
