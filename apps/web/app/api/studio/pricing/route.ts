import { NextResponse } from "next/server";
import { query, getPricingSettings, resolveAiAssistPricing, AI_ASSIST_KINDS, getUploadLimitsForUser } from "@vchatbot/core";
import { requireUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

/** GET: AI 보조 생성 비용 (화면의 버튼 라벨용) — kind별 요율 + BYOK 정보 */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const p = await getPricingSettings();
  const rows = await query<{ claude_api_key: string | null }>(
    "SELECT claude_api_key FROM users WHERE id = ?",
    [auth.userId]
  );
  const aiAssist: Record<string, { coinsPer1k: number; minCost: number }> = {};
  for (const k of AI_ASSIST_KINDS) aiAssist[k] = resolveAiAssistPricing(p, k);
  return NextResponse.json({
    aiAssistCost: p.aiAssistCost,
    illustGenCost: p.illustGenCost,
    videoGenCost: p.videoGenCost,
    aiAssist,
    byok: { enabled: !!p.byok?.enabled, cost: p.byok?.cost ?? 0, hasKey: !!rows[0]?.claude_api_key },
    limits: await getUploadLimitsForUser(auth.userId),
  });
}
