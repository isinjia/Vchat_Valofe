import { createHash } from "crypto";
import { getLlmSettings } from "./settings";
import { resolveProviderById, createAdapter } from "./llm/routing";
import type { LlmStreamOutcome } from "./llm/adapter";
import type { CharacterPersona } from "./types";

/**
 * 크롬 내장 AI(브라우저 레벨)용 압축 캐릭터 설정.
 * - Gemini Nano 는 세션 입력 한도가 작아(수천 토큰) 긴 캐릭터 설정이 그대로 들어가지 않는다.
 * - 압축은 플랫폼이 자동으로 하지 않고, 캐릭터 편집자가 스튜디오에서 수동 생성한다 (보조 LLM 1회).
 * - 원본 설정이 바뀌면 해시가 어긋나 "재생성 필요" 상태가 되지만, 채팅은 구버전 압축본으로 계속 동작한다.
 */

/** 원본 설정 합계가 이 글자수 이하면 압축 없이 원본을 그대로 쓴다 */
export const COMPACT_SOURCE_LIMIT = 2800;
/** 압축 결과 목표 글자수 */
export const COMPACT_TARGET_CHARS = 1200;

type PersonaFields = Pick<CharacterPersona, "profile" | "personality" | "speech_style" | "scenario" | "ai_prompt">;

/** 압축 대상 원본(캐릭터 설정 필드 전체)을 하나의 문자열로 */
export function compactPersonaSource(c: PersonaFields): string {
  return [c.profile, c.personality, c.speech_style, c.scenario ?? "", c.ai_prompt].join("\n---\n");
}

export function compactPersonaHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export type CompactStatus =
  | "ready" // 생성본이 최신
  | "stale" // 설정이 바뀌어 재생성 필요 (채팅은 구버전으로 동작)
  | "missing"; // 생성본 없음 — 생성 전에는 브라우저 레벨 사용 불가

export function compactPersonaStatus(c: CharacterPersona): CompactStatus {
  if (c.compact_prompt == null) return "missing";
  return c.compact_prompt_hash === compactPersonaHash(compactPersonaSource(c)) ? "ready" : "stale";
}

/**
 * 채팅(브라우저 레벨)에서 쓸 생성본 해석.
 * - ready/stale → 생성본 사용 (stale 이어도 채팅은 유지 — 재생성 안내는 스튜디오에서만)
 * - missing → usable=false ([생성] 전에는 사용 불가)
 * 생성본이 빈 문자열(설정이 거의 없는 캐릭터)이면 override 없이 원본 프롬프트를 쓴다.
 */
export function resolveCompactPersona(c: CharacterPersona): { usable: boolean; override: string | null } {
  if (compactPersonaStatus(c) === "missing") return { usable: false, override: null };
  const text = String(c.compact_prompt ?? "").trim();
  return { usable: true, override: text || null };
}

/**
 * 설정이 짧은 캐릭터용: 압축 없이 원본 필드를 구조화 텍스트로 캐싱 (LLM/과금 없음).
 * 압축본과 같은 자리(compact_prompt)에 저장되어 흐름이 하나로 통일된다.
 */
export function buildCachedPersona(c: PersonaFields): string {
  return [
    c.profile.trim(),
    c.personality.trim() ? `# 성격\n${c.personality.trim()}` : "",
    c.speech_style.trim() ? `# 말투\n${c.speech_style.trim()}` : "",
    c.scenario?.trim() ? `# 현재 상황\n${c.scenario.trim()}` : "",
    c.ai_prompt.trim() ? `# 상세 지침\n${c.ai_prompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const SUMMARIZE_SYSTEM = `긴 캐릭터 설정을 입력 한도가 작은 소형 LLM 용 시스템 프롬프트로 압축하는 작업이다.
캐릭터의 정체성·성격·말투가 유지되도록 핵심만 남긴다. 출력은 압축된 설정 텍스트만 — 머리말, 설명, 마크다운 제목을 붙이지 않는다.`;

/**
 * 보조 LLM 으로 캐릭터 설정을 압축한다 (호출부에서 과금 처리).
 * 반환: 압축 텍스트와 토큰 사용량(요율 과금용)
 */
export async function summarizeCompactPersona(opts: {
  characterName: string;
  worldName: string;
  source: string;
}): Promise<{ text: string; usage: LlmStreamOutcome["usage"]; providerId: number | null; accountId: number | null }> {
  const llm = await getLlmSettings();
  const assist = llm.assistProviderId ? await resolveProviderById(Number(llm.assistProviderId)) : null;
  const adapter = await createAdapter(assist?.provider ?? null, assist?.account ?? null);
  const stream = adapter.streamChat({
    system: SUMMARIZE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `다음 캐릭터 설정 전체를 ${COMPACT_TARGET_CHARS}자 이내로 압축하라.
유지할 것: 정체성(이름·신분·배경 한 줄), 성격 핵심, 말투 규칙과 특징적 어미(실제 말투 예시 1~2문장 포함), 상대를 부르는 호칭, 절대 금지사항, 현재 상황.
버릴 것: 중복 설명, 장황한 배경 서사, 사례 나열.

[캐릭터: ${opts.characterName} / 세계관: ${opts.worldName}]

${opts.source}`,
      },
    ],
    maxTokens: 2048,
  });
  let text = "";
  for await (const d of stream.deltas) text += d;
  text = text.trim();
  if (!text) throw new Error("압축 결과가 비어 있습니다.");
  const outcome = stream.outcome();
  return {
    text: text.slice(0, COMPACT_TARGET_CHARS * 2),
    usage: outcome.usage,
    providerId: assist?.provider.id ?? null,
    accountId: assist?.account?.id ?? null,
  };
}
