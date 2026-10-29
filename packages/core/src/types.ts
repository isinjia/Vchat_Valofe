// ===== MySQL 엔티티 =====

export interface World {
  id: number;
  name: string;
  description: string;
  ai_prompt: string;
  is_active: number;
  owner_user_id: number | null;
  visibility: "private" | "open";
  status: "active" | "suspended";
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
  created_at: string;
  updated_at: string;
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
  /** 응답 텍스트에 이 키워드가 포함되면 노출 */
  keywords: string[];
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
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ChatTier {
  id: number;
  name: string;
  description: string | null;
  is_default: number;
  chat_cost: number;
  created_at: string;
}

export interface TierLlmAssignment {
  id: number;
  tier_id: number;
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
  description: string;
  created_at: string;
}
