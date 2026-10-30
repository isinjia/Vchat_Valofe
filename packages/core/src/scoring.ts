import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4"; // SDK 헬퍼가 zod v4 API 필요 (zod 3.25 에 v4 서브패스 포함)
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getScoringSettings } from "./settings";
import { resolveProviderById, createAdapter } from "./llm/routing";
import { recordLlmUsage } from "./llm/accounts";
import type { LlmProviderRow, LlmAccountRow } from "./types";

/** 캐릭터 감정 키 (프로필 이미지 교체용). 'default' 는 기본 프로필 슬롯 */
export const CHARACTER_EMOTIONS = ["joy", "sad", "angry", "shy", "surprised", "love", "neutral"] as const;
export type CharacterEmotion = (typeof CHARACTER_EMOTIONS)[number];
export const EMOTION_LABELS: Record<string, string> = {
  default: "기본",
  joy: "기쁨",
  sad: "슬픔",
  angry: "화남",
  shy: "부끄러움",
  surprised: "놀람",
  love: "애정",
  neutral: "평온",
};

export const ScoreSchema = z.object({
  affinityDelta: z.number().int().min(-5).max(5),
  /** 이번 응답에서 캐릭터가 드러낸 감정 (프로필 교체용). 누락/비정상 값은 normalizeScore 가 null 로 보정 */
  emotion: z.enum(CHARACTER_EMOTIONS).nullable(),
  /** 대화에서 캐릭터가 유저를 부르는 호칭이 새로 정해졌으면 그 호칭, 아니면 null */
  callName: z.string().nullable(),
  emotionalEvent: z
    .object({
      scope: z.enum(["character", "world"]),
      summary: z.string(), // 대화 포인트 한 문장
      situation: z.string(), // 당시 상황 한 문장
    })
    .nullable(),
  updatedFacts: z.array(z.string()).nullable(), // 변화 없으면 null
  // 게스트 난입: 후보 목록에서 고른 인물 + 끼어드는 이유. 대부분 null
  guestAppearance: z.object({ name: z.string(), line_hint: z.string() }).nullable(),
});

export type ScoreResult = z.infer<typeof ScoreSchema>;

const SYSTEM_PROMPT = `너는 롤플레이 채팅의 관계 분석가다. 유저 발화와 캐릭터 응답을 보고 다음을 판단하라.
(1) affinityDelta: 캐릭터가 유저에게 느낄 호감 변화 -5~+5 (대부분 -1~+1, 큰 사건만 ±3 이상).
(2) emotionalEvent: 관계나 감정에 큰 변화가 생긴 경우만 기록, 아니면 null. scope 는 'character'(사적 관계·비밀·감정의 순간) 또는 'world'(그 세계에서 널리 알려질 만한 유저의 행적·사건·평판). 비밀 고백·사적 감정은 절대 world 로 분류하지 말고, 애매하면 character. summary 는 대화 포인트 한 문장, situation 은 당시 상황 한 문장.
(3) updatedFacts: 유저에 대해 새로 알게 된 사실(좋아하는 것/싫어하는 것/직업/현재상황/신상)이 있으면 기존 목록을 갱신한 '전체 목록'(각 항목 '분류: 내용' 형식, 최대 30개)을 반환, 변화 없으면 null. 대화에서 명시된 것만, 추측 금지.
(5) emotion: 이번 캐릭터 응답에서 드러난 캐릭터의 감정 하나 — joy(기쁨)/sad(슬픔)/angry(화남)/shy(부끄러움)/surprised(놀람)/love(애정)/neutral(평온) 중 하나. 뚜렷하지 않으면 neutral.
(6) callName: 이번 대화에서 캐릭터가 유저를 부를 호칭이 '새로' 정해지거나 바뀐 경우에만 그 호칭(예: "오빠", "자기야", "민수 님"). 정해진 적 없거나 변화 없으면 null.
(4) guestAppearance: 대화 맥락상 제3의 인물이 잠깐 끼어드는 것이 '매우' 자연스러운 경우에만(드물게 — 확신이 없으면 null), 후보 목록에서 이름 하나를 고르고 끼어드는 이유를 line_hint 로 한 문장. 후보 목록에 없는 인물은 절대 선택 금지. 유저가 그 인물을 직접 불렀거나 화제의 중심일 때만 고려하라. 현재 장면을 먼저 판단하라. 단둘이 있는 사적·밀폐된 공간(방, 둘만의 통화/밀담 등)이거나 제3자가 있을 수 없는 상황이면 반드시 null. 공공장소·열린 공간·여럿이 있을 법한 장소이거나, 대화 내용상 그 인물이 근처에 있다고 언급된 경우에만 고려하라. SNS/메신저 대화 상황이라면 그 인물이 대화에 끼어드는 것(댓글/멘션처럼)은 자연스러울 수 있다. line_hint 에는 어떤 경로로 끼어드는지(지나가다 들음, 옆에 있었음, 메신저에 끼어듦 등)를 포함하라. 후보 목록이 '(없음)' 이면 반드시 null.`;

const JSON_INSTRUCTION = `

[출력 형식 — 매우 중요]
반드시 아래 JSON 객체 하나로만 응답하라. 설명·인사말·마크다운·코드펜스(\`\`\`) 금지. 첫 글자는 { 마지막 글자는 } 여야 한다.
필드 6개를 모두 포함하고, 해당 없으면 null 을 써라.
{
  "affinityDelta": 정수 -5~5 (소수·문자열 금지),
  "emotion": "joy|sad|angry|shy|surprised|love|neutral 중 하나",
  "callName": null 또는 "새로 정해진 유저 호칭",
  "emotionalEvent": null 또는 {"scope": "character" 또는 "world", "summary": "대화 포인트 한 문장", "situation": "당시 상황 한 문장"},
  "updatedFacts": null 또는 ["분류: 내용", ...] (문자열 배열),
  "guestAppearance": null 또는 {"name": "후보 목록 중 하나의 이름", "line_hint": "끼어드는 이유 한 문장"}
}
예시 1 (평범한 대화): {"affinityDelta": 1, "emotion": "neutral", "callName": null, "emotionalEvent": null, "updatedFacts": null, "guestAppearance": null}
예시 2 (사건 발생): {"affinityDelta": 3, "emotion": "joy", "callName": "오빠", "emotionalEvent": {"scope": "character", "summary": "유저가 비밀을 털어놓았다", "situation": "단둘이 있는 저녁 무렵"}, "updatedFacts": ["취미: 독서"], "guestAppearance": null}`;

function nullish(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return ["", "null", "none", "없음"].includes(v.trim().toLowerCase());
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** 모델 출력의 사소한 형식 오류(문자열 숫자, 빈 값 등)를 보정 */
function normalizeScore(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = { ...(raw as Record<string, unknown>) };
  const n = Math.round(Number(r.affinityDelta));
  if (Number.isFinite(n)) r.affinityDelta = Math.max(-5, Math.min(5, n));
  if (nullish(r.emotion) || !CHARACTER_EMOTIONS.includes(String(r.emotion) as CharacterEmotion)) {
    r.emotion = null;
  }
  if (nullish(r.callName)) r.callName = null;
  else r.callName = String(r.callName).slice(0, 64);
  if (nullish(r.emotionalEvent)) r.emotionalEvent = null;
  else if (typeof r.emotionalEvent === "object") {
    const e = { ...(r.emotionalEvent as Record<string, unknown>) };
    if (e.scope !== "world") e.scope = "character";
    r.emotionalEvent = e;
  }
  if (nullish(r.updatedFacts)) r.updatedFacts = null;
  else if (typeof r.updatedFacts === "string") r.updatedFacts = [r.updatedFacts];
  else if (Array.isArray(r.updatedFacts)) r.updatedFacts = r.updatedFacts.map((x) => String(x));
  if (nullish(r.guestAppearance)) r.guestAppearance = null;
  return r;
}

/** 응답 텍스트에서 JSON 객체를 추출·파싱·검증 */
function parseScoreText(text: string): ScoreResult {
  const stripped = text.replace(/```(?:json)?/gi, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("채점 응답에서 JSON 을 찾지 못했습니다.");
  const obj = JSON.parse(stripped.slice(start, end + 1));
  const first = ScoreSchema.safeParse(obj);
  if (first.success) return first.data;
  const second = ScoreSchema.safeParse(normalizeScore(obj));
  if (second.success) return second.data;
  throw new Error(`채점 결과 스키마 불일치: ${second.error.message.slice(0, 200)}`);
}

async function scoreViaProvider(
  provider: LlmProviderRow,
  account: LlmAccountRow | null,
  content: string
): Promise<ScoreResult & { usage?: { inputTokens: number; outputTokens: number } }> {
  const adapter = await createAdapter(provider, account);
  const stream = adapter.streamChat({
    system: SYSTEM_PROMPT + JSON_INSTRUCTION,
    messages: [{ role: "user", content }],
    maxTokens: 1024,
  });
  let text = "";
  for await (const d of stream.deltas) text += d;
  const usage = stream.outcome().usage;
  if (usage) {
    await recordLlmUsage(provider.id, account?.id ?? null, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  }
  const parsed = parseScoreText(text);
  return usage ? { ...parsed, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } } : parsed;
}

let client: Anthropic | null = null;

/** 한 턴(유저 발화 + 캐릭터 응답)을 채점한다. enabled 확인은 호출부에서 한다 */
export async function scoreExchange(input: {
  characterName: string;
  worldName: string;
  userMessage: string;
  assistantMessage: string;
  currentAffinity: number;
  currentFacts: string[];
  /** 게스트 난입 후보 인물 이름 (비어 있으면 guestAppearance 는 null) */
  guestCandidates: string[];
  /** 캐릭터의 상황 설정(현재 장면). 게스트 등장 정합성 판단용 */
  scenario: string | null;
}): Promise<ScoreResult & { usage?: { inputTokens: number; outputTokens: number } }> {
  const settings = await getScoringSettings();
  client ??= new Anthropic();

  const factsText =
    input.currentFacts.length > 0 ? input.currentFacts.map((f) => `- ${f}`).join("\n") : "(없음)";
  const content = `세계관: ${input.worldName}
캐릭터: ${input.characterName}
현재 호감도: ${input.currentAffinity} (-100~100)
기존 유저 팩트:
${factsText}

[현재 장면/상황]
${input.scenario?.trim() || "(설정 없음)"}

게스트 후보 목록:
${input.guestCandidates.length > 0 ? input.guestCandidates.map((n) => `- ${n}`).join("\n") : "(없음) — 이 경우 guestAppearance 는 반드시 null"}

[유저 발화]
${input.userMessage}

[캐릭터 응답]
${input.assistantMessage}`;

  if (settings.scoringProviderId) {
    const resolved = await resolveProviderById(Number(settings.scoringProviderId));
    if (resolved) return scoreViaProvider(resolved.provider, resolved.account, content);
    console.warn(`채점용 LLM(id=${settings.scoringProviderId}) 사용 불가 — Anthropic 직접 호출로 폴백`);
  }

  const response = await client.messages.parse({
    model: settings.model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ScoreSchema) },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("채점 결과를 해석하지 못했습니다.");
  return {
    ...parsed,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
