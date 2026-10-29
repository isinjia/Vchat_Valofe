-- LLM 다중 등록 + 채팅 등급별 AI 할당/비율 라우팅
-- ALTER 에는 IF NOT EXISTS 가 없으므로 1회만 적용할 것.

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

CREATE TABLE IF NOT EXISTS chat_tiers (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  is_default  TINYINT(1) NOT NULL DEFAULT 0,
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

ALTER TABLE users ADD COLUMN tier_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_users_tier FOREIGN KEY (tier_id) REFERENCES chat_tiers(id) ON DELETE SET NULL;

INSERT INTO chat_tiers (name, description, is_default) VALUES ('일반', '기본 등급', 1);
