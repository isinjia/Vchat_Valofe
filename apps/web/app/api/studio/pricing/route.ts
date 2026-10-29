import { NextResponse } from "next/server";
import { getPricingSettings } from "@vchatbot/core";
import { requireUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

/** GET: AI 보조 생성 비용 (화면의 버튼 라벨용) */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const p = await getPricingSettings();
  return NextResponse.json({ aiAssistCost: p.aiAssistCost, illustGenCost: p.illustGenCost });
}
