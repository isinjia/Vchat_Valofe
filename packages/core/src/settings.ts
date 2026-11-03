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

/** 호감도 구간 정의 — 구간별 반응 가이드의 공통 축 (UI/프롬프트 양쪽에서 사용) */
export type AffinityBandKey = "hostile" | "cold" | "neutral" | "friendly" | "devoted";
export interface AffinityBand {
  key: AffinityBandKey;
  label: string;
  min: number;
  max: number;
}
export const AFFINITY_BANDS: AffinityBand[] = [
  { key: "hostile", label: "적대", min: -100, max: -60 },
  { key: "cold", label: "냉담", min: -59, max: -20 },
  { key: "neutral", label: "중립", min: -19, max: 19 },
  { key: "friendly", label: "호감", min: 20, max: 59 },
  { key: "devoted", label: "애정", min: 60, max: 100 },
];

/** 구간별 반응 가이드 텍스트 (비어 있는 구간은 상위 기본값으로 폴백) */
export type AffinityPrompts = Partial<Record<AffinityBandKey, string>>;

export const DEFAULT_AFFINITY_PROMPTS: Record<AffinityBandKey, string> = {
  hostile: "상대를 경계하고 적대적이다. 말이 짧고 가시가 돋쳐 있으며, 부탁은 차갑게 거절하고 곁을 주지 않는다.",
  cold: "거리를 둔다. 사무적이고 건조한 말투로 필요한 말만 하고, 사적인 질문은 가볍게 흘려 넘긴다.",
  neutral: "무난하게 대한다. 예의는 지키지만 특별한 친밀감은 드러내지 않고, 상대에 따라 조금씩 마음을 여는 중이다.",
  friendly: "호의적이다. 말투가 부드럽고 먼저 농담이나 사적인 이야기를 꺼내며, 상대의 안부를 챙긴다.",
  devoted: "깊이 신뢰하고 아낀다. 다정함이 자연스럽게 배어나오고, 상대를 우선으로 생각하며 솔직한 속마음도 보여준다.",
};

/** 전역 기본값: 관리자 설정(app_settings.affinity_prompts)이 있으면 내장 기본값 위에 덮는다 */
export async function getAffinityPromptDefaults(): Promise<Record<AffinityBandKey, string>> {
  const v = await getSetting<AffinityPrompts>("affinity_prompts");
  const out = { ...DEFAULT_AFFINITY_PROMPTS };
  for (const b of AFFINITY_BANDS) {
    const t = typeof v?.[b.key] === "string" ? v[b.key]!.trim() : "";
    if (t) out[b.key] = t;
  }
  return out;
}

/** 현재 호감도가 속한 구간 */
export function bandForAffinity(affinity: number): AffinityBand {
  const a = Math.max(-100, Math.min(100, Math.round(affinity)));
  return AFFINITY_BANDS.find((b) => a >= b.min && a <= b.max) ?? AFFINITY_BANDS[2];
}

/** JSON 컬럼 값(객체 또는 문자열)을 AffinityPrompts 로 정규화 */
export function parseAffinityPrompts(v: unknown): AffinityPrompts | null {
  let obj = v;
  if (typeof obj === "string") {
    try { obj = JSON.parse(obj); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const out: AffinityPrompts = {};
  for (const b of AFFINITY_BANDS) {
    const t = (obj as Record<string, unknown>)[b.key];
    if (typeof t === "string" && t.trim()) out[b.key] = t.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 캐릭터별 설정 → 전역 기본값 순으로 현재 구간의 반응 가이드를 해석 */
export function resolveAffinityGuide(
  affinity: number,
  charPrompts: AffinityPrompts | null | undefined,
  defaults: Record<AffinityBandKey, string>
): string {
  const band = bandForAffinity(affinity);
  return charPrompts?.[band.key]?.trim() || defaults[band.key];
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

/**
 * 수수료 비율 (0~1). creatorRate: 채팅 비용 중 제작자 몫, worldRate: 제작자 몫 중 세계관 소유자 몫,
 * giftRate: 선물 아이템 판매액 중 캐릭터 제작자 몫
 */
export interface FeeSettings {
  creatorRate: number;
  worldRate: number;
  giftRate: number;
}
export const DEFAULT_FEE_SETTINGS: FeeSettings = { creatorRate: 0.3, worldRate: 0.2, giftRate: 0.3 };

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

/** 결제/충전 설정 — chargeUrl: 코인 충전 페이지 링크 (빈 값이면 충전 버튼 숨김) */
export interface BillingSettings {
  chargeUrl: string;
}
export const DEFAULT_BILLING_SETTINGS: BillingSettings = { chargeUrl: "" };

export async function getBillingSettings(): Promise<BillingSettings> {
  const v = await getSetting<Partial<BillingSettings>>("billing");
  return { chargeUrl: typeof v?.chargeUrl === "string" ? v.chargeUrl : "" };
}

/** 업로드 용량 제한 (MB) — 관리자 설정에서 변경 */
export interface UploadLimitSettings {
  /** 일러스트 영상 업로드 최대 (MB) */
  videoMaxMb: number;
  /** 프로필 효과 이미지(GIF/APNG) 최대 (MB) — 말풍선마다 반복 렌더되므로 작게 유지 권장 */
  effectMaxMb: number;
}
export const DEFAULT_UPLOAD_LIMITS: UploadLimitSettings = { videoMaxMb: 100, effectMaxMb: 2 };

export async function getUploadLimitSettings(): Promise<UploadLimitSettings> {
  const v = await getSetting<Partial<UploadLimitSettings>>("uploads");
  const num = (x: unknown, d: number) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    videoMaxMb: num(v?.videoMaxMb, DEFAULT_UPLOAD_LIMITS.videoMaxMb),
    effectMaxMb: num(v?.effectMaxMb, DEFAULT_UPLOAD_LIMITS.effectMaxMb),
  };
}

/** 유저의 업로드 제한: 크리에이터 등급의 쿼터(있으면)가 전역 기본값을 덮는다 */
export async function getUploadLimitsForUser(userId: number): Promise<UploadLimitSettings> {
  const base = await getUploadLimitSettings();
  const rows = await query<{ video_max_mb: number | null; effect_max_mb: number | null }>(
    `SELECT t.video_max_mb, t.effect_max_mb
     FROM users u JOIN chat_tiers t ON t.id = u.creator_tier_id
     WHERE u.id = ?`,
    [userId]
  );
  const t = rows[0];
  return {
    videoMaxMb: t?.video_max_mb != null && Number(t.video_max_mb) > 0 ? Number(t.video_max_mb) : base.videoMaxMb,
    effectMaxMb: t?.effect_max_mb != null && Number(t.effect_max_mb) > 0 ? Number(t.effect_max_mb) : base.effectMaxMb,
  };
}

/**
 * VMsgCenter(VMessage 런처 메신저) 챗봇 연동 설정.
 * 챗봇 1개 = VMessage client id 1개 = 캐릭터 1명. 콜백 주소는 /api/vmsg/callback (VMessage 관리자 화면에 등록).
 */
export interface VmsgBotConfig {
  /** VMessage 발급 챗봇 Client ID (vbot_...) — 콜백 헤더 X-VMsg-Bot-Id 로 들어온다 */
  botClientId: string;
  /** VMessage 발급 Client Secret — 콜백 HMAC 서명 검증 + 답장 API 인증에 사용 */
  clientSecret: string;
  /** 이 챗봇으로 대화할 캐릭터 */
  characterId: number;
  enabled: boolean;
}
export interface VmsgSettings {
  enabled: boolean;
  /** VMessage 메신저 웹 서버 주소 (예: https://vmsg.example.com:4000) — /bot/v1/* 의 베이스 */
  apiBase: string;
  /** 콜백 허용 IP 목록. 비어 있으면 IP 제한 없음 (서명 검증은 항상 수행) */
  allowedIps: string[];
  bots: VmsgBotConfig[];
}
export const DEFAULT_VMSG_SETTINGS: VmsgSettings = { enabled: false, apiBase: "", allowedIps: [], bots: [] };

export async function getVmsgSettings(): Promise<VmsgSettings> {
  const v = await getSetting<Partial<VmsgSettings>>("vmsg");
  return normalizeVmsgSettings(v);
}

/** 저장값/입력값을 VmsgSettings 로 정규화 (admin PUT 과 조회 양쪽에서 사용) */
export function normalizeVmsgSettings(v: unknown): VmsgSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const ips = Array.isArray(o.allowedIps)
    ? o.allowedIps.map((x) => String(x).trim()).filter(Boolean)
    : typeof o.allowedIps === "string"
      ? o.allowedIps.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
      : [];
  const bots: VmsgBotConfig[] = (Array.isArray(o.bots) ? o.bots : [])
    .map((b) => {
      const r = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
      return {
        botClientId: String(r.botClientId ?? "").trim(),
        clientSecret: String(r.clientSecret ?? ""),
        characterId: Math.max(0, Math.floor(Number(r.characterId) || 0)),
        enabled: r.enabled !== false,
      };
    })
    .filter((b) => b.botClientId.length > 0);
  return {
    enabled: !!o.enabled,
    apiBase: String(o.apiBase ?? "").trim().replace(/\/+$/, ""),
    allowedIps: ips,
    bots,
  };
}

/** 스튜디오 AI 보조 기능별 과금: 1K토큰(입력+출력)당 코인 + 최소(정액) 코인 */
export interface AiAssistPricing {
  /** 1,000토큰당 코인. 0 이면 minCost 정액만 차감 */
  coinsPer1k: number;
  /** 최소(정액) 코인 */
  minCost: number;
}

/** 스튜디오 AI 보조 기능(kind) 목록 — /api/studio/generate 의 TASKS + 압축(compact_prompt, 별도 라우트) */
export const AI_ASSIST_KINDS = [
  "world_description",
  "world_prompt",
  "profile",
  "personality",
  "speech_style",
  "scenario",
  "greeting",
  "compact_prompt",
  "story_card",
  "story_scene",
] as const;

export const AI_ASSIST_KIND_LABELS: Record<string, string> = {
  world_description: "세계관 설명",
  world_prompt: "세계관 공통 프롬프트",
  profile: "캐릭터 프로필",
  personality: "기본 성격",
  speech_style: "말투",
  scenario: "상황 설정",
  greeting: "첫 인사말",
  compact_prompt: "브라우저 AI 압축",
  story_card: "스토리 카드 텍스트",
  story_scene: "스토리 플레이 장면",
};

/** 코인 가격 설정 */
export interface PricingSettings {
  /** 기능별 미설정 시 기본 정액(코인) */
  aiAssistCost: number;
  illustGenCost: number;
  /** AI 영상 생성 1회 비용(코인) */
  videoGenCost: number;
  /** AI 보조 기능(kind)별 과금 설정 */
  aiAssist?: Partial<Record<string, AiAssistPricing>>;
  /** 유저 본인 Claude 키(BYOK) 사용 시: 허용 여부 + 1회 정액 코인 */
  byok?: { enabled: boolean; cost: number };
}
export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  aiAssistCost: 50,
  illustGenCost: 500,
  videoGenCost: 2000,
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
