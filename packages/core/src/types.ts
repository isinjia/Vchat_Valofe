// ===== MySQL 엔티티 =====

export interface World {
  id: number;
  name: string;
  description: string;
  ai_prompt: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export type DictionaryCategory = "location" | "person" | "term";

export interface DictionaryEntry {
  id: number;
  world_id: number;
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
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CharacterRelationship {
  id: number;
  character_id: number;
  target_character_id: number;
  relation: string;
  target_name?: string;
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
