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
  type World,
} from "@vchatbot/core";
import { requireUser, ownedWorld, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";

const client = new Anthropic();

const SYSTEM_PROMPT =
  "당신은 AI 캐릭터 채팅 서비스의 세계관/캐릭터 설정 작가다. 주어진 설정에 어긋나지 않게, 요청받은 텍스트만 한국어로 출력하라. 제목, 따옴표 설명, 메타 설명, 마크다운 없이 본문만 출력한다.";

const FIELD_LABEL: Record<string, string> = {
  profile: "캐릭터 설정(프로필)",
  personality: "기본 성격",
  speech_style: "말투",
  ai_prompt: "상세 프롬프트",
  scenario: "상황 설정",
  greeting: "첫 인사말",
};

const TASKS: Record<string, string> = {
  world_description:
    "이 세계관의 배경, 시대, 분위기, 핵심 규칙을 담은 세계관 설명을 6~10문장 한국어로 써라.",
  world_prompt:
    "이 세계관의 모든 캐릭터에게 공통 적용할 AI 롤플레이 지침(세계관 일관성, 어휘/문체, 금지 사항 등)을 항목별로 간결하게 써라.",
  profile: "이 캐릭터의 출신, 외모, 배경 스토리를 담은 캐릭터 설정을 5~8문장 한국어로 써라.",
  personality: "이 캐릭터의 기본 성격을 장점과 단점, 특징적 습관을 포함해 3~5문장 한국어로 써라.",
  speech_style:
    "이 캐릭터의 말투(존댓말/반말, 자주 쓰는 어미와 감탄사, 예시 대사 2~3개)를 3~5문장 한국어로 써라.",
  scenario: "이 캐릭터와 유저의 1:1 대화가 시작되기 좋은 구체적 상황 1개를 3~5문장 한국어로 써라.",
  greeting: "캐릭터가 대화 시작 시 유저에게 먼저 건네는 첫 대사를 캐릭터 말투로 2~4문장으로 써라.",
};

/**
 * POST /api/studio/generate
 *   { kind, worldId?, characterId?, hint?, fields?: Record<string,string> }
 * AI 로 초안을 생성해 {text, cost, balance} 로 반환. 생성 성공 후에만 코인 차감.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { userId } = auth;

  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind ?? "");
  if (!Object.prototype.hasOwnProperty.call(TASKS, kind)) return bad("kind 가 올바르지 않습니다.");
  const isWorldKind = kind.startsWith("world_");
  const hint = typeof body.hint === "string" ? body.hint.trim() : "";
  const fields: Record<string, string> =
    body.fields && typeof body.fields === "object" ? body.fields : {};

  // 대상 리소스 소유권 검사
  let world: World | undefined;
  let refType: string;
  let refId: number;
  let characterName = "";
  if (isWorldKind) {
    if (body.worldId == null) return bad("worldId 가 필요합니다.");
    const own = await ownedWorld(body.worldId, userId);
    if ("res" in own) return own.res;
    world = own.row as unknown as World;
    refType = "world";
    refId = world.id;
  } else {
    if (body.characterId == null) return bad("characterId 가 필요합니다.");
    const own = await ownedCharacter(body.characterId, userId);
    if ("res" in own) return own.res;
    refType = "character";
    refId = Number(own.row.id);
    characterName = String(own.row.name ?? "");
    // 화면에서 선택 중인 세계관이 있으면 사용 가능한 세계관일 때만 반영
    const wid = Number(fields.world_id) || Number(own.row.world_id);
    const ws = await query<World>(
      `SELECT * FROM worlds WHERE id = ? AND (owner_user_id = ? OR (visibility = 'open' AND status = 'active'))`,
      [wid, userId]
    );
    world = ws[0];
  }

  // 컨텍스트 구성 (편집 중 미저장 값 우선)
  const worldName = isWorldKind && typeof fields.name === "string" && fields.name ? fields.name : world?.name;
  const worldDesc =
    isWorldKind && typeof fields.description === "string" ? fields.description : world?.description;
  const parts: string[] = [];
  if (worldName) parts.push(`# 세계관: ${worldName}\n${worldDesc ?? ""}`);
  if (!isWorldKind) {
    const name = typeof fields.name === "string" && fields.name ? fields.name : characterName;
    parts.push(`# 캐릭터 이름: ${name}`);
    for (const [k, label] of Object.entries(FIELD_LABEL)) {
      const v = typeof fields[k] === "string" ? fields[k].trim() : "";
      if (v && k !== kind) parts.push(`# ${label}\n${v}`);
    }
  }
  if (hint) parts.push(`# 작성 요청/힌트\n${hint}`);

  const pricing = await getPricingSettings();
  // 유저 본인 Claude 키(BYOK): 관리자가 허용했고 키가 등록돼 있으면 유저 키로 직접 호출 (코인은 정액만)
  const keyRows = await query<{ claude_api_key: string | null }>(
    "SELECT claude_api_key FROM users WHERE id = ?",
    [userId]
  );
  const userKey = keyRows[0]?.claude_api_key || "";
  const byokActive = !!(pricing.byok?.enabled && userKey);
  let cost = byokActive ? pricing.byok!.cost : resolveAiAssistPricing(pricing, kind).minCost;

  let text: string;
  try {
    const llm = await getLlmSettings();
    const userContent = `${parts.join("\n\n")}\n\n---\n${TASKS[kind]}`;
    const assist =
      !byokActive && llm.assistProviderId ? await resolveProviderById(Number(llm.assistProviderId)) : null;
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
        // usage(response.usage)는 BYOK 과금에 쓰지 않는다 (정액)
      } catch (err) {
        // 유저 키 호출 실패: 코인 차감 없이 502
        console.error("studio generate byok error:", err);
        const detail =
          err instanceof Anthropic.APIError
            ? `(${err.status}): ${err.message}`
            : `: ${(err as Error).message ?? "알 수 없는 오류"}`;
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
        cost = calcAiAssistCost(resolveAiAssistPricing(pricing, kind), usage);
      }
    } else {
      const response = await client.messages.create({
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
      cost = calcAiAssistCost(resolveAiAssistPricing(pricing, kind), {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    }
  } catch (err) {
    console.error("studio generate error:", err);
    const msg =
      err instanceof Anthropic.APIError
        ? `AI 호출 오류 (${err.status}): ${err.message}`
        : "AI 생성 중 오류가 발생했습니다.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  if (!text) return NextResponse.json({ error: "생성 결과가 비어 있습니다." }, { status: 502 });

  // 생성 성공 후 차감
  const balance = await chargeCoins(userId, cost, "ai_assist_spend", {
    refType,
    refId,
    memo: byokActive ? `${kind} (내 키)` : kind,
  });
  return NextResponse.json({ text, cost, balance, byok: byokActive });
}
