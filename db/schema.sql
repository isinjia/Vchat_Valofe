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
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 채팅 등급 (유저에게 부여, 등급별로 LLM 을 가중치 비율로 할당)
--   기본 등급은 최초 1회 수동 INSERT:
--   INSERT INTO chat_tiers (name, description, is_default) VALUES ('일반', '기본 등급', 1);
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_tiers (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  is_default  TINYINT(1) NOT NULL DEFAULT 0,
  chat_cost   INT NOT NULL DEFAULT 100,                -- 메시지 1회 코인 비용
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tier_llm_assignments (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tier_id         BIGINT UNSIGNED NOT NULL,
  llm_provider_id BIGINT UNSIGNED NOT NULL,
  weight          INT NOT NULL DEFAULT 1,              -- 비율 가중치
  CONSTRAINT fk_tla_tier FOREIGN KEY (tier_id) REFERENCES chat_tiers(id) ON DELETE CASCADE,
  CONSTRAINT fk_tla_llm  FOREIGN KEY (llm_provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE,
  UNIQUE KEY uq_tier_llm (tier_id, llm_provider_id)
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
  tier_id       BIGINT UNSIGNED NULL,                  -- 채팅 등급 (NULL 이면 기본 등급)
  coins         BIGINT NOT NULL DEFAULT 0,             -- 보유 코인
  status        ENUM('active','banned') NOT NULL DEFAULT 'active',
  vfun_u_no     BIGINT UNSIGNED NULL,                  -- vfun 고유 회원번호
  vfun_user_id  VARCHAR(128) NULL,                     -- vfun 로그인 ID
  profile_image VARCHAR(1024) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_vfun (vfun_u_no),
  CONSTRAINT fk_users_tier FOREIGN KEY (tier_id) REFERENCES chat_tiers(id) ON DELETE SET NULL
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
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  owner_user_id BIGINT UNSIGNED NULL,             -- 제작 유저 (NULL = 운영 소유)
  visibility  ENUM('private','open') NOT NULL DEFAULT 'private',
  status      ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_worlds_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
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
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  owner_user_id  BIGINT UNSIGNED NULL,             -- 제작 유저 (NULL = 운영 소유)
  visibility  ENUM('private','open') NOT NULL DEFAULT 'private',
  status      ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_char_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  CONSTRAINT fk_chars_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_char_world (world_id)
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
-- 코인 거래 원장 (+지급 / -차감)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coin_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  type ENUM('auto_topup','chat_spend','ai_assist_spend','illust_gen_spend','chat_fee_income','world_fee_income') NOT NULL,
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
  facts JSON NULL,                        -- 유저 팩트 (짧은 문자열 배열, 최대 30)
  message_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ucs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ucs_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ucs (user_id, character_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 기념일: 관리자 프리셋 + 세계관별 기념일(프리셋 스냅샷 복사 또는 커스텀)
CREATE TABLE IF NOT EXISTS anniversary_presets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  month TINYINT UNSIGNED NOT NULL,   -- 1~12
  day TINYINT UNSIGNED NOT NULL,     -- 1~31
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
