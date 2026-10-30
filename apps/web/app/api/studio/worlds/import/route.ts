import { NextRequest, NextResponse } from "next/server";
import { importWorld, evaluateTierPromotions } from "@vchatbot/core";
import { requireUser, bad } from "@/lib/studio";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 세계관 JSON 가져오기 → 내 비공개 세계관 생성 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const body = await req.json().catch(() => null);
  try {
    const result = await importWorld(body, auth.userId);
    // 크리에이터 등급 자동 승급 평가 (비동기, 실패 무시)
    void evaluateTierPromotions(auth.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return bad((e as Error).message);
  }
}
