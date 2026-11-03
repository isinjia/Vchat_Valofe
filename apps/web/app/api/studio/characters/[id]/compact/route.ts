import { NextRequest, NextResponse } from "next/server";
import {
  execute,
  query,
  chargeCoins,
  getPricingSettings,
  resolveAiAssistPricing,
  calcAiAssistCost,
  recordLlmUsage,
  invalidateChatContext,
  compactPersonaSource,
  compactPersonaHash,
  summarizeCompactPersona,
  buildCachedPersona,
  COMPACT_SOURCE_LIMIT,
  type CharacterPersona,
} from "@vchatbot/core";
import { requireUser, ownedCharacter } from "@/lib/studio";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/studio/characters/[id]/compact — 브라우저 AI 용 프로필 생성 (수동).
 * 저장된 설정(DB) 기준으로, 짧으면 그대로 구조화 캐싱(무료), 길면 보조 LLM 압축(코인).
 * 길이 판단은 서버가 하므로 편집자는 버튼만 누르면 된다.
 * 자동 재생성은 하지 않는다 — 설정이 바뀌면 편집 화면에 "재생성 필요"만 표시된다.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;

  const row = own.row as unknown as CharacterPersona;
  const source = compactPersonaSource(row);

  // 짧은 설정: 압축 없이 원본을 구조화해 캐싱 (LLM 호출/과금 없음)
  if (source.length <= COMPACT_SOURCE_LIMIT) {
    await execute(
      "UPDATE characters SET compact_prompt = ?, compact_prompt_hash = ? WHERE id = ? AND owner_user_id = ?",
      [buildCachedPersona(row), compactPersonaHash(source), Number(id), auth.userId]
    );
    await invalidateChatContext(Number(id));
    return NextResponse.json({ status: "ready", method: "cached", cost: 0 });
  }

  const pricing = await getPricingSettings();
  const pr = resolveAiAssistPricing(pricing, "compact_prompt");
  let cost = pr.minCost;

  let text: string;
  try {
    const worlds = await query<{ name: string }>("SELECT name FROM worlds WHERE id = ?", [row.world_id]);
    const r = await summarizeCompactPersona({
      characterName: row.name,
      worldName: worlds[0]?.name ?? "",
      source,
    });
    text = r.text;
    if (r.usage) {
      await recordLlmUsage(r.providerId, r.accountId, r.usage);
      cost = calcAiAssistCost(pr, r.usage);
    }
  } catch (err) {
    console.error("compact persona generate error:", err);
    return NextResponse.json({ error: `압축 생성 중 오류: ${(err as Error).message}` }, { status: 502 });
  }

  await execute("UPDATE characters SET compact_prompt = ?, compact_prompt_hash = ? WHERE id = ? AND owner_user_id = ?", [
    text,
    compactPersonaHash(source),
    Number(id),
    auth.userId,
  ]);
  await invalidateChatContext(Number(id));

  // 생성 성공 후 차감 (스튜디오 AI 보조와 동일 체계)
  const balance = await chargeCoins(auth.userId, cost, "ai_assist_spend", {
    refType: "character",
    refId: Number(id),
    memo: "compact_prompt",
  });
  return NextResponse.json({ status: "ready", method: "compressed", compact_prompt: text, cost, balance });
}
