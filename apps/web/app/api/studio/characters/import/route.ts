import { NextRequest, NextResponse } from "next/server";
import { importCharacter, evaluateTierPromotions } from "@vchatbot/core";
import { requireUser, bad, canUseWorld, checkWorldNameScope } from "@/lib/studio";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 캐릭터 JSON 가져오기: body { worldId, data } — worldId 는 내 세계관 또는 open+active 세계관만 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const body = await req.json().catch(() => ({}));
  if (!(await canUseWorld(body?.worldId, auth.userId))) return bad("사용할 수 없는 세계관입니다.", 403);
  const importName = typeof body?.data?.name === "string" ? body.data.name.trim() : "";
  const scopeErr = await checkWorldNameScope(body.worldId, auth.userId, importName);
  if (scopeErr) return bad(scopeErr);
  try {
    const result = await importCharacter(body?.data, Number(body.worldId), auth.userId);
    // 크리에이터 등급 자동 승급 평가 (비동기, 실패 무시)
    void evaluateTierPromotions(auth.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return bad((e as Error).message);
  }
}
