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
};

export async function getLlmSettings(): Promise<LlmSettings> {
  return (await getSetting<LlmSettings>("llm")) ?? DEFAULT_LLM_SETTINGS;
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
}
export const DEFAULT_SCORING_SETTINGS: ScoringSettings = {
  model: "claude-haiku-5-5",
  enabled: true,
  guestEnabled: true,
  guestMinGap: 5,
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

/** 코인 가격 설정 */
export interface PricingSettings {
  aiAssistCost: number;
  illustGenCost: number;
}
export const DEFAULT_PRICING_SETTINGS: PricingSettings = { aiAssistCost: 50, illustGenCost: 500 };

export async function getPricingSettings(): Promise<PricingSettings> {
  const v = await getSetting<Partial<PricingSettings>>("pricing");
  return { ...DEFAULT_PRICING_SETTINGS, ...(v ?? {}) };
}
