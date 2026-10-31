-- VChatBot MySQL 스키마
-- 설정 / 유저 / 세계관 / 사전 / 캐릭터 / 일러스트 메타데이터
-- (채팅 로그는 MongoDB chat_messages 컬렉션에 저장)

CREATE DATABASE IF NOT EXISTS vchatbot
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vchatbot;

-- ---------------------------------------------------------------
-- LLM 제공자 (다중 등록, on/off)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS llm_providers (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(128) NOT NULL,                    -- 표시명
  provider   ENUM('anthropic','openai_compatible') NOT NULL,
  model      VARCHAR(128) NOT NULL,
  api_key    VARCHAR(512) NULL,                        -- anthropic 은 비우면 환경변수 사용
  base_url   VARCHAR(512) NULL,                        -- openai_compatible 필수 (예: https://api.deepseek.com/v1)
  max_tokens INT NOT NULL DEFAULT 4096,
  cost_per_1m_input  DECIMAL(12,4) NOT NULL DEFAULT 0, -- 입력 1M 토큰당 비용 (예상 비용 표시용)
  cost_per_1m_output DECIMAL(12,4) NOT NULL DEFAULT 0, -- 출력 1M 토큰당 비용
  cost_currency      VARCHAR(8) NOT NULL DEFAULT 'USD',
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 이미지 생성 AI 프로바이더 (OpenAI / Gemini / OpenAI 호환)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS image_providers (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(128) NOT NULL,
  provider   ENUM('openai','gemini','openai_compatible') NOT NULL DEFAULT 'openai',
  model      VARCHAR(128) NOT NULL,
  api_key    VARCHAR(512) NULL,
  base_url   VARCHAR(512) NULL,                         -- openai_compatible 용. 비우면 공식 엔드포인트
  size       VARCHAR(32) NOT NULL DEFAULT '1024x1536',  -- openai: WxH, gemini: 가로:세로 비율로 자동 변환
  cost_per_image DECIMAL(12,4) NOT NULL DEFAULT 0,      -- 장당 비용 (예상 비용 표시용)
  cost_currency  VARCHAR(8) NOT NULL DEFAULT 'USD',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 영상 생성 AI 프로바이더 (OpenAI Sora / Gemini Veo / OpenAI 호환)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS video_providers (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(128) NOT NULL,
  provider   ENUM('openai','gemini','openai_compatible') NOT NULL DEFAULT 'openai',
  model      VARCHAR(128) NOT NULL,
  api_key    VARCHAR(512) NULL,
  base_url   VARCHAR(512) NULL,                         -- openai_compatible 용. 비우면 공식 엔드포인트
  size       VARCHAR(32) NOT NULL DEFAULT '720x1280',   -- openai: WxH, gemini: 가로:세로 비율로 자동 변환
  duration_seconds INT NOT NULL DEFAULT 8,              -- 생성 영상 길이(초)
  cost_per_video DECIMAL(12,4) NOT NULL DEFAULT 0,      -- 건당 비용 (예상 비용 표시용)
  cost_currency  VARCHAR(8) NOT NULL DEFAULT 'USD',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 등급 (track='user': 채팅 활동 등급(할인 혜택) / track='creator': 창작 등급(수수료 가산 혜택))
--   conditions(JSON) 충족 시 자동 승급. 채팅 LLM 선택은 ai_levels 가 담당.
--   기본 유저 등급은 최초 1회 수동 INSERT:
--   INSERT INTO chat_tiers (name, description, is_default) VALUES ('일반', '기본 등급', 1);
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_tiers (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(64) NOT NULL,
  icon          VARCHAR(255) NULL,                     -- 이모지 또는 이미지 URL (상단바 등급 표시)
  track         ENUM('user','creator') NOT NULL DEFAULT 'user',
  tier_rank     INT NOT NULL DEFAULT 0,                -- 트랙 내 순위 (높을수록 상위)
  is_override   TINYINT(1) NOT NULL DEFAULT 0,         -- 우선 적용: 조건 충족 시 사다리 무시·최우선 (강등 포함)
  description   VARCHAR(255) NULL,
  is_default    TINYINT(1) NOT NULL DEFAULT 0,
  chat_cost     INT NOT NULL DEFAULT 100,              -- 메시지 1회 코인 비용 (AI 레벨이 없을 때의 레거시 비용)
  discount_rate DECIMAL(5,2) NOT NULL DEFAULT 0,       -- user 트랙: 할인율(%) — AI 레벨 비용에 적용
  conditions    JSON NULL,                             -- 자동 승급 조건 (모두 충족 시). NULL = 자동 승급 없음
  fee_bonus     DECIMAL(5,2) NOT NULL DEFAULT 0,       -- creator 트랙: 수수료율 가산(%p)
  video_max_mb  INT NULL,                               -- creator 트랙: 영상 업로드 최대 MB (NULL=전역 기본)
  effect_max_mb INT NULL,                               -- creator 트랙: 효과 이미지 최대 MB (NULL=전역 기본)
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 채팅 AI 레벨 (유저가 직접 선택하는 모델 등급 — 유저 등급은 할인 역할)
--   kind='browser' 는 유저 PC 의 Chrome 내장 AI(Gemini Nano) 사용
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_levels (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  level       INT NOT NULL,                              -- 표시용 레벨 번호 (0, 1, 2...)
  name        VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  kind        ENUM('browser','server') NOT NULL DEFAULT 'server',
  chat_cost   INT NOT NULL DEFAULT 100,                  -- 메시지 1회 기본 코인 (유저 등급 할인 전)
  is_default  TINYINT(1) NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_levels_level (level)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_level_llm_assignments (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ai_level_id     BIGINT UNSIGNED NOT NULL,
  llm_provider_id BIGINT UNSIGNED NOT NULL,
  weight          INT NOT NULL DEFAULT 1,                -- 비율 가중치
  CONSTRAINT fk_alla_level FOREIGN KEY (ai_level_id) REFERENCES ai_levels(id) ON DELETE CASCADE,
  CONSTRAINT fk_alla_llm   FOREIGN KEY (llm_provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE,
  UNIQUE KEY uq_level_llm (ai_level_id, llm_provider_id)
) ENGINE=InnoDB;

-- LLM 멀티 계정 + 월 쿼터
CREATE TABLE IF NOT EXISTS llm_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  llm_provider_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(128) NOT NULL,
  api_key VARCHAR(512) NULL,
  monthly_token_limit BIGINT NOT NULL DEFAULT 0,  -- 월 토큰 한도(입력+출력 합). 0 = 무제한
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lacc_provider FOREIGN KEY (llm_provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS llm_account_usage (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  llm_account_id BIGINT UNSIGNED NOT NULL,
  month CHAR(7) NOT NULL,  -- 'YYYY-MM' (UTC)
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  request_count BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT fk_laccu_account FOREIGN KEY (llm_account_id) REFERENCES llm_accounts(id) ON DELETE CASCADE,
  UNIQUE KEY uq_account_month (llm_account_id, month)
) ENGINE=InnoDB;

-- 프로바이더 단위 월 사용량 (계정 미등록 호출 포함 — 예상 비용 집계용)
CREATE TABLE IF NOT EXISTS llm_provider_usage (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  llm_provider_id BIGINT UNSIGNED NOT NULL,
  month CHAR(7) NOT NULL,  -- 'YYYY-MM' (UTC)
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  request_count BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT fk_lpu_provider FOREIGN KEY (llm_provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE,
  UNIQUE KEY uq_provider_month (llm_provider_id, month)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 유저
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  nickname      VARCHAR(64)  NOT NULL,
  role          ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  tier_id       BIGINT UNSIGNED NULL,                  -- 유저 등급 (NULL 이면 기본 등급)
  creator_tier_id BIGINT UNSIGNED NULL,                -- 크리에이터 등급 (NULL 이면 아직 크리에이터 아님)
  ai_level_id   BIGINT UNSIGNED NULL,                  -- 선택한 채팅 AI 레벨 (NULL 이면 기본 레벨)
  coins         BIGINT NOT NULL DEFAULT 0,             -- 보유 코인
  status        ENUM('active','banned') NOT NULL DEFAULT 'active',
  vfun_u_no     BIGINT UNSIGNED NULL,                  -- vfun 고유 회원번호
  vfun_user_id  VARCHAR(128) NULL,                     -- vfun 로그인 ID
  profile_image VARCHAR(1024) NULL,
  claude_api_key VARCHAR(255) NULL,                    -- 본인 Claude API 키 (스튜디오 AI 보조 BYOK)
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_vfun (vfun_u_no),
  CONSTRAINT fk_users_tier FOREIGN KEY (tier_id) REFERENCES chat_tiers(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_creator_tier FOREIGN KEY (creator_tier_id) REFERENCES chat_tiers(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_ai_level FOREIGN KEY (ai_level_id) REFERENCES ai_levels(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 활동 집계 (등급 승급 평가용 증분 카운터)
CREATE TABLE IF NOT EXISTS user_stats (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  messages BIGINT NOT NULL DEFAULT 0,      -- 보낸 채팅 메시지 수
  tokens_used BIGINT NOT NULL DEFAULT 0,   -- 사용한 토큰(입력+출력)
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ustats_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 제재 (유저: 모든/신규 채팅 금지, 캐릭터: 기간제 비공개) — 이력 보존, 중도 해제는 revoked_at
--   활성 제재 = revoked_at IS NULL AND ends_at > NOW()
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sanctions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target_type ENUM('user','character') NOT NULL,
  target_id   BIGINT UNSIGNED NOT NULL,
  kind        ENUM('chat_block','new_chat_block','hide','admin_block') NOT NULL,
  reason      VARCHAR(255) NULL,
  admin_id    BIGINT UNSIGNED NULL,   -- 제재한 관리자 (통합 관리자 인증 도입 시 기록)
  starts_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at     DATETIME NOT NULL,
  revoked_at  DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sanctions_target (target_type, target_id, ends_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 이벤트 채팅: 조건 발동 → 이벤트 상황 대화 → 성공/실패 판정 → 달성 저장
--   실패 시 retry_hours 후 재발동, 성공 시 set_relationship 로 관계 플래그
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS character_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  trigger_affinity_min INT NULL,
  trigger_keywords VARCHAR(255) NULL,
  trigger_relationship ENUM('none','lover','engaged','married') NULL,
  situation TEXT NOT NULL,
  success_condition TEXT NOT NULL,
  fail_condition TEXT NULL,
  set_relationship ENUM('lover','engaged','married') NULL,
  success_line TEXT NULL,                               -- 달성 시 캐릭터가 하는 고정 대사
  success_illustration_id BIGINT UNSIGNED NULL,         -- 달성 시 출력할 일러스트
  retry_hours INT NOT NULL DEFAULT 72,
  max_turns INT NOT NULL DEFAULT 6,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cev_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT fk_cev_sill FOREIGN KEY (success_illustration_id) REFERENCES illustrations(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_character_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  event_id BIGINT UNSIGNED NOT NULL,
  status ENUM('active','success','failed') NOT NULL DEFAULT 'active',
  turns INT NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  KEY idx_uce_user (user_id, character_id, status),
  KEY idx_uce_event (event_id, user_id, status),
  CONSTRAINT fk_uce_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uce_event FOREIGN KEY (event_id) REFERENCES character_events(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 캐릭터 프로필 이미지 (원형, 채팅 말풍선 앞). emotion='default' 기본 + 감정 키별 교체
CREATE TABLE IF NOT EXISTS character_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  emotion VARCHAR(16) NOT NULL DEFAULT 'default',  -- default | joy | sad | angry | shy | surprised | love | neutral
  storage_key VARCHAR(512) NOT NULL,
  url VARCHAR(1024) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cprof (character_id, emotion),
  CONSTRAINT fk_cprof_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 캐릭터 좋아요 (토글, characters.like_count 로 집계)
CREATE TABLE IF NOT EXISTS character_likes (
  user_id      BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, character_id),
  KEY idx_clikes_character (character_id),
  CONSTRAINT fk_clikes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_clikes_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 유저 알림 (등급 승급 등)
CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body VARCHAR(1024) NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_unotif_user (user_id, read_at),
  CONSTRAINT fk_unotif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 앱 설정 (key-value, 값은 JSON)
--   storage: { "type": "s3" | "ftp", "s3": {...}, "ftp": {...} }
--   llm:     { "model": "claude-opus-5-5", "maxTokens": 4096 }
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  value       JSON NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 세계관
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS worlds (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(128) NOT NULL,
  description MEDIUMTEXT   NOT NULL,              -- 기본 세계관 설정
  ai_prompt   MEDIUMTEXT   NOT NULL,              -- 세계관 공통 AI 명령용 프롬프트
  title_image_key VARCHAR(512)  NULL,             -- 타이틀 이미지(3:4 세로형) 스토리지 키
  title_image_url VARCHAR(1024) NULL,
  title_color VARCHAR(7) NULL,                    -- 타이틀 컬러(#rrggbb) — 캐릭터 카드 테두리/배경 톤
  like_count  INT NOT NULL DEFAULT 0,             -- 좋아요 수 (world_likes 비정규화 집계)
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  owner_user_id BIGINT UNSIGNED NULL,             -- 제작 유저 (NULL = 운영 소유)
  visibility  ENUM('private','open') NOT NULL DEFAULT 'private',  -- UI 용어: 공유
  open_scope  ENUM('all','dict_person') NOT NULL DEFAULT 'all',   -- 공유 시 타 유저 캐릭터 작성 범위
  status      ENUM('active','suspended') NOT NULL DEFAULT 'active',
  delete_scheduled_at DATETIME NULL,                -- 삭제 대기 (3일 후 실제 삭제, 그 전 취소 가능)
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_worlds_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 세계관 좋아요 (토글, worlds.like_count 로 집계)
CREATE TABLE IF NOT EXISTS world_likes (
  user_id    BIGINT UNSIGNED NOT NULL,
  world_id   BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, world_id),
  KEY idx_wlikes_world (world_id),
  CONSTRAINT fk_wlikes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_wlikes_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 세계관 사전 (지역 / 인명 / 용어 공용)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_dictionary (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  world_id     BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NULL,              -- NULL=세계관 공통, 값 있으면 해당 캐릭터 전용 지식
  linked_character_id BIGINT UNSIGNED NULL,       -- person 항목 ↔ 실제 캐릭터 연결 (FK 는 하단 ALTER)
  category   ENUM('location', 'person', 'term') NOT NULL,
  title      VARCHAR(128) NOT NULL,
  aliases    VARCHAR(255) NULL,                   -- 쉼표 구분 이명/별칭
  content    MEDIUMTEXT   NOT NULL,
  embedding  JSON NULL,                           -- multilingual-e5-small 벡터(384)
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dict_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  INDEX idx_dict_world_cat (world_id, category, sort_order),
  INDEX idx_dict_world_char (world_id, character_id)
) ENGINE=InnoDB;
-- character_id FK 는 characters 테이블 생성 이후 파일 하단에서 ALTER 로 추가

-- ---------------------------------------------------------------
-- 캐릭터 페르소나
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS characters (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  world_id     BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(128) NOT NULL,
  profile      MEDIUMTEXT NOT NULL,               -- 캐릭터 설정
  personality  MEDIUMTEXT NOT NULL,               -- 기본 성격
  speech_style MEDIUMTEXT NOT NULL,               -- 말투
  ai_prompt    MEDIUMTEXT NOT NULL,               -- 캐릭터별 세세한 프롬프트
  scenario     MEDIUMTEXT NULL,                   -- 대화 시작 상황 설정
  greeting     MEDIUMTEXT NULL,                   -- 제작자가 쓴 첫 인사말 (비우면 AI 자동 생성)
  title_image_key VARCHAR(512)  NULL,             -- 타이틀 이미지(3:4 세로형) 스토리지 키
  title_image_url VARCHAR(1024) NULL,
  chat_count   BIGINT UNSIGNED NOT NULL DEFAULT 0, -- 누적 대화 수 (인기순 정렬용)
  like_count   INT NOT NULL DEFAULT 0,             -- 좋아요 수 (character_likes 비정규화 집계)
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  owner_user_id  BIGINT UNSIGNED NULL,             -- 제작 유저 (NULL = 운영 소유)
  visibility  ENUM('private','open') NOT NULL DEFAULT 'private',
  share_key   VARCHAR(32) NULL,                     -- 비공개 링크 공유용 랜덤 키 (?k= 로 입장, 지연 생성)
  advanced_profile TINYINT(1) NOT NULL DEFAULT 0,   -- 고급 프로필(세트) 사용 여부 — OFF 면 기본 프로필만
  status      ENUM('active','suspended') NOT NULL DEFAULT 'active',
  delete_scheduled_at DATETIME NULL,                 -- 삭제 대기 (3일 후 실제 삭제, 그 전 취소 가능)
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_char_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  CONSTRAINT fk_chars_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_char_world (world_id),
  UNIQUE KEY uq_char_world_name (world_id, name)  -- 세계관 내 캐릭터명 중복 불가
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 캐릭터 관계/기억 (대상 = 세계관 공통 사전 항목: 인물·지역·용어)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS character_relationships (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id    BIGINT UNSIGNED NOT NULL,
  target_entry_id BIGINT UNSIGNED NOT NULL,       -- world_dictionary.id (FK 는 하단 ALTER)
  relation        TEXT NOT NULL,                  -- 관계/기억 설명 (예: 소꿉친구, 처음 소풍 간 곳)
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rel_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rel_entry (character_id, target_entry_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 캐릭터 일러스트
--   kind='basic'        : 자주 보이는 기본 일러스트
--   kind='conditional'  : 특정 조건에서만 보이는 일러스트
--   trigger_condition 예: {"type":"keyword","keywords":["화남","분노"]}
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS illustrations (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id      BIGINT UNSIGNED NOT NULL,
  kind              ENUM('basic', 'conditional') NOT NULL DEFAULT 'basic',
  media_type        ENUM('image','video') NOT NULL DEFAULT 'image',
  storage_key       VARCHAR(512) NOT NULL,        -- 스토리지 내 경로
  url               VARCHAR(1024) NOT NULL,       -- 공개 접근 URL
  description       VARCHAR(255) NULL,
  trigger_condition JSON NULL,                    -- conditional 일 때 노출 조건
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_illust_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  INDEX idx_illust_char (character_id, kind, sort_order)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 프로필 세트: 조건(계절/기념일 전후 기간/호감도)에 따라 채팅 아바타를 꾸미는 세트.
--   category 3종(배경/얼굴/효과)을 따로 지정하고, 충족 세트를 배경→얼굴(감정별)→효과 순으로 겹쳐 표시
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS character_profile_sets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  category ENUM('background','face','effect') NOT NULL,
  name VARCHAR(100) NOT NULL,
  season ENUM('spring','summer','autumn','winter') NULL,
  anniversary_id BIGINT UNSIGNED NULL,
  days_before SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  days_after SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  min_affinity INT NULL,
  emotion VARCHAR(16) NULL,                     -- 감정 조건 (effect 전용): 채점 감정이 일치할 때만
  bg_rule JSON NULL,                            -- face 전용: 배경 호환 규칙 {mode:'allow'|'deny', ids:[배경세트id]} (NULL=전부 허용)
  storage_key VARCHAR(512) NULL,                -- background/effect 의 단일 이미지
  url VARCHAR(1024) NULL,
  effect_scale DECIMAL(6,3) NOT NULL DEFAULT 1, -- effect 배치: 원 지름=1 기준 가로 크기
  effect_x DECIMAL(6,3) NOT NULL DEFAULT 0,     -- effect 중심의 원 중심 대비 오프셋 (지름 단위)
  effect_y DECIMAL(6,3) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cps_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  -- anniversary_id FK 는 world_anniversaries 생성 이후 하단 후행 ALTER 에서 추가
  INDEX idx_cps_char (character_id, category, sort_order)
) ENGINE=InnoDB;

-- 얼굴세트의 감정별 이미지 (투명배경 권장)
CREATE TABLE IF NOT EXISTS character_profile_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  set_id BIGINT UNSIGNED NOT NULL,
  emotion VARCHAR(16) NOT NULL DEFAULT 'default',
  storage_key VARCHAR(512) NOT NULL,
  url VARCHAR(1024) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cpi (set_id, emotion),
  CONSTRAINT fk_cpi_set FOREIGN KEY (set_id) REFERENCES character_profile_sets(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 세계관 일러스트: 지역사전(location) 항목별 배경 이미지 여러 장
--   dict_entry_id NULL = 세계관 공통 배경
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_illustrations (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  world_id      BIGINT UNSIGNED NOT NULL,
  dict_entry_id BIGINT UNSIGNED NULL,
  storage_key   VARCHAR(512) NOT NULL,
  url           VARCHAR(1024) NOT NULL,
  description   VARCHAR(255) NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wi_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  CONSTRAINT fk_wi_entry FOREIGN KEY (dict_entry_id) REFERENCES world_dictionary(id) ON DELETE CASCADE,
  INDEX idx_wi_world (world_id, dict_entry_id, sort_order)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 코인 거래 원장 (+지급 / -차감)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coin_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  type ENUM('auto_topup','chat_spend','ai_assist_spend','illust_gen_spend','video_gen_spend','chat_fee_income','world_fee_income') NOT NULL,
  ref_type VARCHAR(32) NULL, ref_id BIGINT UNSIGNED NULL,
  memo VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ct_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ct_user (user_id, created_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 호감도 / 유저 팩트 (유저 x 캐릭터)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_character_state (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  affinity INT NOT NULL DEFAULT 0,       -- -100 ~ 100
  relationship ENUM('none','lover','engaged','married') NOT NULL DEFAULT 'none', -- 이벤트 성공으로 켜지는 관계 플래그
  call_name VARCHAR(64) NULL,             -- 캐릭터가 유저를 부르는 호칭 (대화에서 정해지면 저장)
  current_place_id BIGINT UNSIGNED NULL,  -- 현재 장면의 지역 (채점 LLM 이 지역사전 후보 중 식별)
  facts JSON NULL,                        -- 유저 팩트 (짧은 문자열 배열, 최대 30)
  message_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ucs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ucs_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT fk_ucs_place FOREIGN KEY (current_place_id) REFERENCES world_dictionary(id) ON DELETE SET NULL,
  UNIQUE KEY uq_ucs (user_id, character_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 기념일: 관리자 프리셋 + 세계관별 기념일(프리셋 스냅샷 복사 또는 커스텀)
CREATE TABLE IF NOT EXISTS anniversary_presets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  month TINYINT UNSIGNED NOT NULL,   -- 1~12
  day TINYINT UNSIGNED NOT NULL,     -- 1~31
  notice_days TINYINT UNSIGNED NOT NULL DEFAULT 7, -- 기념일 N일 전부터 언급 (0 = 당일만)
  duration_days SMALLINT NOT NULL DEFAULT 1,       -- 시작일부터 며칠간 이어지는지 (축제/행사형)
  description TEXT NOT NULL,          -- 어떤 날인지 설명
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS world_anniversaries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  world_id BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NULL,  -- NULL = 세계관 공통, 값 = 그 캐릭터 개인 기념일 (FK 는 하단 후행 ALTER)
  preset_id BIGINT UNSIGNED NULL,     -- 출처 프리셋 (NULL = 그 세계관 커스텀)
  name VARCHAR(128) NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  day TINYINT UNSIGNED NOT NULL,
  notice_days TINYINT UNSIGNED NOT NULL DEFAULT 7, -- 기념일 N일 전부터 언급 (0 = 당일만)
  duration_days SMALLINT NOT NULL DEFAULT 1,       -- 시작일부터 며칠간 이어지는지 (축제/행사형)
  description TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wa_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  CONSTRAINT fk_wa_preset FOREIGN KEY (preset_id) REFERENCES anniversary_presets(id) ON DELETE SET NULL,
  INDEX idx_wa_world (world_id, month, day),
  INDEX idx_wa_char (character_id, month, day)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 후행 제약: world_dictionary.character_id (characters 생성 이후에 추가해야 함)
-- ---------------------------------------------------------------
ALTER TABLE world_dictionary
  ADD CONSTRAINT fk_dict_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE;
ALTER TABLE world_dictionary
  ADD CONSTRAINT fk_dict_linked_char FOREIGN KEY (linked_character_id) REFERENCES characters(id) ON DELETE SET NULL;
ALTER TABLE character_relationships
  ADD CONSTRAINT fk_rel_entry FOREIGN KEY (target_entry_id) REFERENCES world_dictionary(id) ON DELETE CASCADE;
ALTER TABLE world_anniversaries
  ADD CONSTRAINT fk_wa_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE;
ALTER TABLE character_profile_sets
  ADD CONSTRAINT fk_cps_anniv FOREIGN KEY (anniversary_id) REFERENCES world_anniversaries(id) ON DELETE SET NULL;
