-- VChatBot MySQL 스키마
-- 설정 / 유저 / 세계관 / 사전 / 캐릭터 / 일러스트 메타데이터
-- (채팅 로그는 MongoDB chat_messages 컬렉션에 저장)

CREATE DATABASE IF NOT EXISTS vchatbot
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vchatbot;

-- ---------------------------------------------------------------
-- 유저
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  nickname      VARCHAR(64)  NOT NULL,
  role          ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 세계관 사전 (지역 / 인명 / 용어 공용)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_dictionary (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  world_id   BIGINT UNSIGNED NOT NULL,
  category   ENUM('location', 'person', 'term') NOT NULL,
  title      VARCHAR(128) NOT NULL,
  aliases    VARCHAR(255) NULL,                   -- 쉼표 구분 이명/별칭
  content    MEDIUMTEXT   NOT NULL,
  embedding  JSON NULL,                           -- multilingual-e5-small 벡터(384)
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dict_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  INDEX idx_dict_world_cat (world_id, category, sort_order)
) ENGINE=InnoDB;

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
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_char_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  INDEX idx_char_world (world_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- 캐릭터 간 관계
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS character_relationships (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id        BIGINT UNSIGNED NOT NULL,
  target_character_id BIGINT UNSIGNED NOT NULL,
  relation            TEXT NOT NULL,              -- 관계 설명 (예: 소꿉친구, 라이벌)
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rel_char   FOREIGN KEY (character_id)        REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT fk_rel_target FOREIGN KEY (target_character_id) REFERENCES characters(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rel (character_id, target_character_id)
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
