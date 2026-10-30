// ===== MySQL 엔티티 =====

export interface World {
  id: number;
  name: string;
  description: string;
  ai_prompt: string;
  /** 타이틀 컬러(#rrggbb) — 캐릭터 카드 테두리/배경 톤 */
  title_color?: string | null;
  is_active: number;
  owner_user_id: number | null;
  visibility: "private" | "open";
  status: "active" | "suspended";
  /** 삭제 대기 시각 (설정 후 3일 뒤 실제 삭제, 그 전 취소 가능) */
  delete_scheduled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type DictionaryCategory = "location" | "person" | "term";

export interface DictionaryEntry {
  id: number;
  world_id: number;
  /** NULL = 세계관 공통, 값 있으면 해당 캐릭터 전용 지식 */
  character_id?: number | null;
  /** person 항목에 연결된 실제 캐릭터 (없으면 null) */
  linked_character_id?: number | null;
  category: DictionaryCategory;
  title: string;
  aliases: string | null;
  content: string;
  sort_order: number;
  /** multilingual-e5-small 임베딩 (384차원). 미생성 시 null */
  embedding?: number[] | null;
}

export interface CharacterPersona {
  id: number;
  world_id: number;
  name: string;
  profile: string;
  personality: string;
  speech_style: string;
  ai_prompt: string;
  /** 대화 시작 상황 설정 */
  scenario: string | null;
  /** 제작자가 쓴 첫 인사말 (없으면 AI 가 자동 생성) */
  greeting: string | null;
  is_active: number;
  owner_user_id: number | null;
  visibility: "private" | "open";
  status: "active" | "suspended";
  /** 삭제 대기 시각 (설정 후 3일 뒤 실제 삭제, 그 전 취소 가능) */
  delete_scheduled_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** 제재 (유저: 채팅 금지, 캐릭터: 기간제 비공개). 활성 = revoked_at NULL && ends_at > now */
export interface SanctionRow {
  id: number;
  target_type: "user" | "character";
  target_id: number;
  kind: "chat_block" | "new_chat_block" | "hide" | "admin_block";
  reason: string | null;
  /** 제재한 관리자 (통합 관리자 인증 도입 시 기록) */
  admin_id: number | null;
  starts_at: string;
  ends_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface CharacterRelationship {
  id: number;
  character_id: number;
  /** 대상 사전 항목 (인물·지역·용어 어느 것이든 가능) */
  target_entry_id: number;
  relation: string;
  target_title?: string;
  target_category?: DictionaryCategory;
  linked_character_id?: number | null;
}

export type IllustrationKind = "basic" | "conditional";

export interface IllustrationTrigger {
  type: "keyword";
  /** 응답 텍스트에 이 키워드가 포함되면 노출 (비어 있으면 이벤트 달성 시 기본 로테이션 합류) */
  keywords: string[];
  /** 이 이벤트를 달성(성공)한 유저에게만 노출 */
  requireEventId?: number | null;
}

export interface Illustration {
  id: number;
  character_id: number;
  kind: IllustrationKind;
  storage_key: string;
  url: string;
  description: string | null;
  trigger_condition: IllustrationTrigger | null;
  sort_order: number;
}

// ===== 설정 =====

export interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** S3 호환 스토리지(MinIO 등)의 endpoint. AWS 는 비워둠 */
  endpoint?: string;
  /** 업로드 후 공개 URL prefix. 비우면 S3 기본 URL 사용 */
  publicBaseUrl?: string;
}

export interface FtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** 업로드 기준 디렉터리 (예: /htdocs/uploads) */
  basePath: string;
  /** basePath 가 서빙되는 공개 URL prefix (예: https://cdn.example.com/uploads) */
  publicBaseUrl: string;
  secure?: boolean;
}

export interface StorageSettings {
  type: "s3" | "ftp";
  s3?: S3Config;
  ftp?: FtpConfig;
}

export interface LlmSettings {
  model: string;
  maxTokens: number;
  /** 최근 대화 몇 개를 컨텍스트로 넣을지 */
  historyLimit: number;
  /** 보조 기능(스튜디오/캐릭터 AI 생성)에 쓸 llm_providers.id. null/없음이면 설정 모델 직접 호출 */
  assistProviderId?: number | null;
  /** 등급 할당 없음/전 계정 소진 시 폴백으로 쓸 llm_providers.id. null/없음이면 설정 모델 직접 호출 */
  fallbackProviderId?: number | null;
}

// ===== MongoDB 채팅 로그 =====

export interface ChatMessage {
  userId: number;
  characterId: number;
  role: "user" | "assistant";
  content: string;
  /** 이 메시지와 함께 노출된 일러스트 */
  illustrationId?: number;
  meta?: Record<string, unknown>;
  createdAt: Date;
}

// ===== 호감도 / 기억 =====

/** 유저 x 캐릭터 상태 (MySQL user_character_state) */
export interface UserCharacterState {
  id: number;
  user_id: number;
  character_id: number;
  /** -100 ~ 100 */
  affinity: number;
  facts: string[] | null;
  message_count: number;
  updated_at: string;
}

/** Mongo chat_memories: 감정 기억. character 스코프는 둘만의 기억, world 스코프는 세계에 알려진 일 */
export interface ChatMemory {
  userId: number;
  characterId: number | null;
  worldId: number;
  scope: "character" | "world";
  summary: string;
  situation: string | null;
  affinityDelta: number;
  createdAt: Date;
}

// ===== LLM 라우팅 =====

export type LlmProviderKind = "anthropic" | "openai_compatible";

export interface LlmProviderRow {
  id: number;
  name: string;
  provider: LlmProviderKind;
  model: string;
  api_key: string | null;
  base_url: string | null;
  max_tokens: number;
  /** 입력 1M 토큰당 비용 (예상 비용 표시용) */
  cost_per_1m_input: number;
  /** 출력 1M 토큰당 비용 */
  cost_per_1m_output: number;
  cost_currency: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** 이미지 생성 AI 프로바이더 */
export interface ImageProviderRow {
  id: number;
  name: string;
  provider: "openai" | "gemini" | "openai_compatible";
  model: string;
  api_key: string | null;
  base_url: string | null;
  /** openai: WxH (예: 1024x1536). gemini 는 가로:세로 비율로 자동 변환 */
  size: string;
  cost_per_image: number;
  cost_currency: string;
  is_default: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface LlmAccountRow {
  id: number;
  llm_provider_id: number;
  label: string;
  api_key: string | null;
  monthly_token_limit: number;
  is_active: number;
}

export interface ChatTier {
  id: number;
  name: string;
  /** 이모지 또는 이미지 URL — 상단바 등급 표시용 */
  icon?: string | null;
  /** user = 채팅 활동 등급(할인 혜택), creator = 창작 등급(수수료 가산 혜택) */
  track: "user" | "creator";
  /** 트랙 내 순위 (높을수록 상위, 자동 승급은 위로만) */
  tier_rank: number;
  /** 우선 적용: 조건 충족 시 승급 사다리와 무관하게 최우선 적용 (강등 포함, 해제 시 사다리 복귀) */
  is_override: number;
  description: string | null;
  is_default: number;
  /** 메시지 1회 코인 비용 (AI 레벨이 없을 때의 레거시 비용) */
  chat_cost: number;
  /** user 트랙: 할인율(%) — AI 레벨 비용에 적용 */
  discount_rate: number;
  /** 자동 승급 조건 JSON (TierConditions). NULL = 자동 승급 없음 */
  conditions: string | Record<string, number> | null;
  /** creator 트랙: 수수료율 가산(%p) */
  fee_bonus: number;
  created_at: string;
}

/** 채팅 AI 레벨 — 유저가 직접 선택하는 모델 등급 (유저 등급은 할인 역할) */
export interface AiLevel {
  id: number;
  /** 표시용 레벨 번호 (0, 1, 2...) */
  level: number;
  name: string;
  description: string | null;
  /** browser = 유저 PC 의 Chrome 내장 AI(Gemini Nano) 사용 */
  kind: "browser" | "server";
  /** 메시지 1회 기본 코인 (유저 등급 할인 전) */
  chat_cost: number;
  is_default: number;
  is_active: number;
  created_at?: string;
}

export interface AiLevelLlmAssignment {
  id: number;
  ai_level_id: number;
  llm_provider_id: number;
  weight: number;
  llm_name?: string;
  llm_is_active?: number;
}


/** 관리자가 관리하는 기념일 프리셋 */
export interface AnniversaryPreset {
  id: number;
  name: string;
  month: number; // 1~12
  day: number; // 1~31
  notice_days: number; // 기념일 N일 전부터 언급 (0 = 당일만)
  duration_days: number; // 시작일부터 며칠간 이어지는지 (기본 1)
  description: string;
  created_at: string;
}

/** 세계관별 기념일 (preset_id 가 있으면 프리셋 스냅샷 복사본, NULL 이면 커스텀) */
export interface WorldAnniversary {
  id: number;
  world_id: number;
  /** NULL/undefined = 세계관 공통, 값 = 그 캐릭터만 기억하는 개인 기념일 */
  character_id?: number | null;
  preset_id: number | null;
  name: string;
  month: number;
  day: number;
  /** 기념일 N일 전부터 언급 (0 = 당일만) */
  notice_days: number;
  /** 시작일부터 며칠간 이어지는지 (기본 1 — 축제/행사형은 여러 날) */
  duration_days: number;
  description: string;
  created_at: string;
}
