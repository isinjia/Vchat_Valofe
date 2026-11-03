import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  query,
  chargeCoins,
  getPricingSettings,
  getLlmSettings,
  resolveProviderById,
  createAdapter,
  recordLlmUsage,
  resolveAiAssistPricing,
  calcAiAssistCost,
  normalizeStoryBoard,
  collectStoryGenContext,
  type World,
} from "@vchatbot/core";
import { requireUser, bad } from "@/lib/studio";
import { ownedStory } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sid: string }> };

const KIND = "story_card";
const SYSTEM_PROMPT =
  "당신은 AI 캐릭터 채팅 서비스의 인터랙티브 스토리(비주얼 노벨) 작가다. 주어진 세계관/캐릭터 설정에 어긋나지 않게, 요청받은 스토리 장면 본문만 한국어로 출력하라. 제목, 메타 설명, 마크다운, 선택지 나열 없이 장면 본문만 출력한다.";

/**
 * POST { nodeId, board } — 스토리 카드 텍스트 AI 생성.
 * 앞에 연결된 스토리/선택지가 있으면 그 흐름을 잇고, 없으면 캐릭터 프로필 기반으로 도입부를 쓴다.
 * 생성 성공 후에만 코인 차감 (kind=story_card, BYOK 지원 — studio/generate 와 동일 정책).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { userId } = auth;
  const { id, sid } = await params;
  const g = await ownedStory(id, sid, auth.userId);
  if ("res" in g) return g.res;

  const body = await req.json().catch(() => ({}));
  const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
  const board = normalizeStoryBoard(body.board);
  const node = board.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "story") return bad("nodeId 가 스토리 카드가 아닙니다.");

  // 컨텍스트: 세계관 + 캐릭터 + 앞선 스토리/선택지
  const c = g.characterRow as Record<string, string | number | null>;
  const ws = await query<World>("SELECT * FROM worlds WHERE id = ?", [Number(c.world_id)]);
  const world = ws[0];
  const ctx = collectStoryGenContext(board, nodeId);

  const parts: string[] = [];
  if (world) parts.push(`# 세계관: ${world.name}\n${world.description}`);
  parts.push(
    `# 캐릭터: ${c.name}\n${String(c.profile ?? "")}\n\n성격: ${String(c.personality ?? "")}\n말투: ${String(c.speech_style ?? "")}`
  );
  parts.push(`# 스토리 제목: ${g.story.title}`);
  if (ctx.stories.length > 0) {
    parts.push(
      `# 앞선 장면들 (이 흐름에 자연스럽게 이어서 쓸 것)\n${ctx.stories
        .map((s, i) => `${i + 1}. [${s.title || "장면"}] ${s.text}`)
        .join("\n")}`
    );
  }
  if (ctx.choiceText) parts.push(`# 직전 선택\n유저가 방금 "${ctx.choiceText}" 를 선택했다. 그 선택의 결과로 이어지는 장면이다.`);
  if (node.title.trim()) parts.push(`# 이번 장면 제목\n${node.title.trim()}`);
  if (node.text.trim()) parts.push(`# 기존 초안 (참고해서 더 좋게 다시 쓸 것)\n${node.text.trim().slice(0, 1500)}`);
  const task =
    ctx.stories.length > 0 || ctx.choiceText
      ? "위 흐름에 자연스럽게 이어지는 이번 스토리 장면을 3~7문장 한국어로 써라. 3인칭 지문 서술 중심으로, 캐릭터 대사는 필요할 때만 섞는다."
      : "이 캐릭터와 유저의 인터랙티브 스토리가 시작되는 도입 장면을 3~7문장 한국어로 써라. 3인칭 지문 서술 중심으로, 캐릭터 대사는 필요할 때만 섞는다.";

  const pricing = await getPricingSettings();
  const keyRows = await query<{ claude_api_key: string | null }>("SELECT claude_api_key FROM users WHERE id = ?", [userId]);
  const userKey = keyRows[0]?.claude_api_key || "";
  const byokActive = !!(pricing.byok?.enabled && userKey);
  let cost = byokActive ? pricing.byok!.cost : resolveAiAssistPricing(pricing, KIND).minCost;

  let text: string;
  try {
    const llm = await getLlmSettings();
    const userContent = `${parts.join("\n\n")}\n\n---\n${task}`;
    const assist = !byokActive && llm.assistProviderId ? await resolveProviderById(Number(llm.assistProviderId)) : null;
    if (byokActive) {
      try {
        const response = await new Anthropic({ apiKey: userKey }).messages.create({
          model: llm.model,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userContent }],
        });
        text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
      } catch (err) {
        console.error("story generate byok error:", err);
        const detail =
          err instanceof Anthropic.APIError ? `(${err.status}): ${err.message}` : `: ${(err as Error).message ?? "알 수 없는 오류"}`;
        return NextResponse.json(
          { error: `내 Claude API 키 호출 오류 ${detail} — 스튜디오 홈에서 키를 확인하거나 삭제할 수 있습니다.` },
          { status: 502 }
        );
      }
    } else if (assist) {
      const adapter = await createAdapter(assist.provider, assist.account);
      const stream = adapter.streamChat({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        maxTokens: 1024,
      });
      let acc = "";
      for await (const d of stream.deltas) acc += d;
      text = acc.trim();
      const usage = stream.outcome().usage;
      if (usage) {
        await recordLlmUsage(assist.provider.id, assist.account?.id ?? null, usage);
        cost = calcAiAssistCost(resolveAiAssistPricing(pricing, KIND), usage);
      }
    } else {
      const response = await new Anthropic().messages.create({
        model: llm.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      });
      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      cost = calcAiAssistCost(resolveAiAssistPricing(pricing, KIND), {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    }
  } catch (err) {
    console.error("story generate error:", err);
    const msg = err instanceof Anthropic.APIError ? `AI 호출 오류 (${err.status}): ${err.message}` : "AI 생성 중 오류가 발생했습니다.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  if (!text) return NextResponse.json({ error: "생성 결과가 비어 있습니다." }, { status: 502 });

  const balance = await chargeCoins(userId, cost, "ai_assist_spend", {
    refType: "character",
    refId: Number(id),
    memo: byokActive ? `${KIND} (내 키)` : KIND,
  });
  return NextResponse.json({ text, cost, balance, byok: byokActive });
}
