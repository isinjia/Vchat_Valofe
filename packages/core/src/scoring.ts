import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4"; // SDK 헬퍼가 zod v4 API 필요 (zod 3.25 에 v4 서브패스 포함)
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getScoringSettings } from "./settings";

export const ScoreSchema = z.object({
  affinityDelta: z.number().int().min(-5).max(5),
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
(4) guestAppearance: 대화 맥락상 제3의 인물이 잠깐 끼어드는 것이 '매우' 자연스러운 경우에만(드물게 — 확신이 없으면 null), 후보 목록에서 이름 하나를 고르고 끼어드는 이유를 line_hint 로 한 문장. 후보 목록에 없는 인물은 절대 선택 금지. 유저가 그 인물을 직접 불렀거나 화제의 중심일 때만 고려하라. 현재 장면을 먼저 판단하라. 단둘이 있는 사적·밀폐된 공간(방, 둘만의 통화/밀담 등)이거나 제3자가 있을 수 없는 상황이면 반드시 null. 공공장소·열린 공간·여럿이 있을 법한 장소이거나, 대화 내용상 그 인물이 근처에 있다고 언급된 경우에만 고려하라. SNS/메신저 대화 상황이라면 그 인물이 대화에 끼어드는 것(댓글/멘션처럼)은 자연스러울 수 있다. line_hint 에는 어떤 경로로 끼어드는지(지나가다 들음, 옆에 있었음, 메신저에 끼어듦 등)를 포함하라. 후보 목록이 '(없음)' 이면 반드시 null.`;

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
