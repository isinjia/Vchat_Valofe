-- 채팅 AI 레벨: 유저가 직접 선택하는 모델 등급.
--   - 유저 등급(chat_tiers)은 할인 역할로 분리 (discount_rate)
--   - 레벨별 LLM 할당 (ai_level_llm_assignments). kind='browser' 는 유저 PC 의 Chrome 내장 AI 사용
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

-- 유저가 선택한 레벨 (NULL = 기본 레벨)
ALTER TABLE users ADD COLUMN ai_level_id BIGINT UNSIGNED NULL AFTER tier_id,
  ADD CONSTRAINT fk_users_ai_level FOREIGN KEY (ai_level_id) REFERENCES ai_levels(id) ON DELETE SET NULL;

-- 유저 등급 = 할인율(%). 레벨 비용에 적용된다. chat_cost 는 레벨이 하나도 없을 때의 레거시 비용
ALTER TABLE chat_tiers ADD COLUMN discount_rate DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER chat_cost;

-- 기본 시드: Level 1(기본, 기존 동작 유지 — 할당 없으면 등급 할당/폴백 사용), Level 0(브라우저 AI, 무료)
INSERT INTO ai_levels (level, name, description, kind, chat_cost, is_default, is_active) VALUES
  (0, 'Level 0 — 브라우저 AI', '내 PC 의 Chrome 내장 AI(Gemini Nano)로 대화합니다. 지원 브라우저에서만 쓸 수 있고 품질이 낮을 수 있습니다.', 'browser', 0, 0, 1),
  (1, 'Level 1 — 기본', '서비스 기본 LLM 으로 대화합니다.', 'server', 100, 1, 1);
