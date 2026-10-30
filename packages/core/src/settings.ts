import { query, execute } from "./mysql";
import type { LlmSettings, StorageSettings } from "./types";

export async function getSetting<T>(key: string): Promise<T | null> {
  const rows = await query<{ value: T | string }>(
    "SELECT value FROM app_settings WHERE setting_key = ?",
    [key]
  );
  if (rows.length === 0) return null;
  const v = rows[0].value;
  // mysql2 는 JSON 컬럼을 자동 파싱하지만, 드라이버 설정에 따라 문자열일 수 있음
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await execute(
    `INSERT INTO app_settings (setting_key, value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [key, JSON.stringify(value)]
  );
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  model: "claude-opus-5-5",
  maxTokens: 4096,
  historyLimit: 100,
  assistProviderId: null,
  fallbackProviderId: null,
};

export async function getLlmSettings(): Promise<LlmSettings> {
  const saved = await getSetting<Partial<LlmSettings>>("llm");
  return { ...DEFAULT_LLM_SETTINGS, ...(saved ?? {}) };
}

export async function getStorageSettings(): Promise<StorageSettings | null> {
  return getSetting<StorageSettings>("storage");
}

/** 사전 RAG 사전 검색 설정 */
export interface RagSettings {
  /** 사전 전체 글자수가 이 값 이하면 전체를 시스템 프롬프트에 넣는다 */
  thresholdChars: number;
  topK: number;
  /** 코사인 유사도 하한 (e5 계열은 무관한 문장도 0.7대가 나오므로 높게 설정) */
  minScore: number;
}

export const DEFAULT_RAG_SETTINGS: RagSettings = { thresholdChars: 6000, topK: 8, minScore: 0.78 };

export async function getRagSettings(): Promise<RagSettings> {
  const v = await getSetting<Partial<RagSettings>>("rag");
  return { ...DEFAULT_RAG_SETTINGS, ...(v ?? {}) };
}

/** 호감도 채점 설정 */
export interface ScoringSettings {
  model: string;
  enabled: boolean;
  /** 게스트 난입 연출 사용 여부 */
  guestEnabled: boolean;
  /** 최근 N개 assistant 메시지 안에 게스트가 있었으면 미발동 */
  guestMinGap: number;
  /** 채점용 LLM (llm_providers.id). null = 위 model 로 Anthropic 직접 호출 */
  scoringProviderId?: number | null;
  /** 채점 타임아웃(ms) */
  timeoutMs: number;
}
export const DEFAULT_SCORING_SETTINGS: ScoringSettings = {
  model: "claude-haiku-5-5",
  enabled: true,
  guestEnabled: true,
  guestMinGap: 5,
  scoringProviderId: null,
  timeoutMs: 10000,
};

export async function getScoringSettings(): Promise<ScoringSettings> {
  const v = await getSetting<Partial<ScoringSettings>>("scoring");
  return { ...DEFAULT_SCORING_SETTINGS, ...(v ?? {}) };
}

/** 수수료 비율 (0~1). creatorRate: 채팅 비용 중 제작자 몫, worldRate: 제작자 몫 중 세계관 소유자 몫 */
export interface FeeSettings {
  creatorRate: number;
  worldRate: number;
}
export const DEFAULT_FEE_SETTINGS: FeeSettings = { creatorRate: 0.3, worldRate: 0.2 };

export async function getFeeSettings(): Promise<FeeSettings> {
  const v = await getSetting<Partial<FeeSettings>>("fees");
  return { ...DEFAULT_FEE_SETTINGS, ...(v ?? {}) };
}

/** 이미지 생성(일러스트 AI) 설정 — OpenAI 호환 images API */
export interface ImageGenSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
}
export const DEFAULT_IMAGE_GEN_SETTINGS: ImageGenSettings = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-image-1",
  size: "1024x1536",
};

export async function getImageGenSettings(): Promise<ImageGenSettings> {
  const v = await getSetting<Partial<ImageGenSettings>>("image_gen");
  return { ...DEFAULT_IMAGE_GEN_SETTINGS, ...(v ?? {}) };
}

/** 스튜디오 AI 보조 기능별 과금: 1K토큰(입력+출력)당 코인 + 최소(정액) 코인 */
export interface AiAssistPricing {
  /** 1,000토큰당 코인. 0 이면 minCost 정액만 차감 */
  coinsPer1k: number;
  /** 최소(정액) 코인 */
  minCost: number;
}

/** 스튜디오 AI 보조 기능(kind) 목록 — /api/studio/generate 의 TASKS 와 일치 */
export const AI_ASSIST_KINDS = [
  "world_description",
  "world_prompt",
  "profile",
  "personality",
  "speech_style",
  "scenario",
  "greeting",
] as const;

export const AI_ASSIST_KIND_LABELS: Record<string, string> = {
  world_description: "세계관 설명",
  world_prompt: "세계관 공통 프롬프트",
  profile: "캐릭터 프로필",
  personality: "기본 성격",
  speech_style: "말투",
  scenario: "상황 설정",
  greeting: "첫 인사말",
};

/** 코인 가격 설정 */
export interface PricingSettings {
  /** 기능별 미설정 시 기본 정액(코인) */
  aiAssistCost: number;
  illustGenCost: number;
  /** AI 보조 기능(kind)별 과금 설정 */
  aiAssist?: Partial<Record<string, AiAssistPricing>>;
  /** 유저 본인 Claude 키(BYOK) 사용 시: 허용 여부 + 1회 정액 코인 */
  byok?: { enabled: boolean; cost: number };
}
export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  aiAssistCost: 50,
  illustGenCost: 500,
  aiAssist: {},
  byok: { enabled: true, cost: 10 },
};

export async function getPricingSettings(): Promise<PricingSettings> {
  const v = await getSetting<Partial<PricingSettings>>("pricing");
  return {
    ...DEFAULT_PRICING_SETTINGS,
    ...(v ?? {}),
    aiAssist: { ...(v?.aiAssist ?? {}) },
    byok: { ...DEFAULT_PRICING_SETTINGS.byok!, ...(v?.byok ?? {}) },
  };
}

/** kind 별 과금 설정 해석 (미설정 kind 는 기본 정액 aiAssistCost) */
export function resolveAiAssistPricing(p: PricingSettings, kind: string): AiAssistPricing {
  const k = p.aiAssist?.[kind];
  return {
    coinsPer1k: Math.max(0, Number(k?.coinsPer1k) || 0),
    minCost: Math.max(0, Number(k?.minCost ?? p.aiAssistCost) || 0),
  };
}

/** 토큰 사용량 기반 비용. 요율 0 또는 usage 미제공이면 정액(minCost) */
export function calcAiAssistCost(
  pr: AiAssistPricing,
  usage?: { inputTokens?: number; outputTokens?: number } | null
): number {
  if (pr.coinsPer1k <= 0 || !usage) return pr.minCost;
  const tokens = (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
  return Math.max(pr.minCost, Math.ceil((tokens * pr.coinsPer1k) / 1000));
}
