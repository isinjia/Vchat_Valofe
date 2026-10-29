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
  historyLimit: 30,
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
