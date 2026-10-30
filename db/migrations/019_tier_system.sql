-- 등급 개편: LLM 할당 제거(채팅 모델은 AI 레벨이 담당), 유저/크리에이터 트랙 + 조건 기반 자동 승급
ALTER TABLE chat_tiers
  ADD COLUMN track ENUM('user','creator') NOT NULL DEFAULT 'user' AFTER name,
  ADD COLUMN tier_rank INT NOT NULL DEFAULT 0 AFTER track,
  ADD COLUMN conditions JSON NULL AFTER discount_rate,   -- 승급 조건 (모두 충족 시 승급). NULL/빈 객체 = 자동 승급 없음
  ADD COLUMN fee_bonus DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER conditions;  -- creator 트랙: 수수료율 가산(%p)

-- 채팅 LLM 결정은 ai_levels 로 이관됨
DROP TABLE IF EXISTS tier_llm_assignments;

ALTER TABLE users
  ADD COLUMN creator_tier_id BIGINT UNSIGNED NULL AFTER tier_id,
  ADD CONSTRAINT fk_users_creator_tier FOREIGN KEY (creator_tier_id) REFERENCES chat_tiers(id) ON DELETE SET NULL;

-- 활동 집계 (승급 평가용 증분 카운터 — 나머지 지표는 기존 테이블 COUNT 로 계산)
CREATE TABLE IF NOT EXISTS user_stats (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  messages BIGINT NOT NULL DEFAULT 0,      -- 보낸 채팅 메시지 수
  tokens_used BIGINT NOT NULL DEFAULT 0,   -- 사용한 토큰(입력+출력)
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ustats_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

-- 시드: 유저 트랙 (혜택 = 할인율). 기존 등급(일반 등)은 rank 0 유지
INSERT INTO chat_tiers (name, track, tier_rank, description, is_default, chat_cost, discount_rate, conditions, fee_bonus) VALUES
  ('단골',        'user', 1, '메시지 200회, 5명의 캐릭터와 대화', 0, 100,  3.0, '{"messages":200,"chatCharacters":5}', 0),
  ('수다쟁이',    'user', 2, '메시지 1,000회, 15명/5개 월드와 대화', 0, 100,  5.0, '{"messages":1000,"chatCharacters":15,"chatWorlds":5}', 0),
  ('이야기꾼',    'user', 3, '메시지 5,000회, 누적 200만 토큰', 0, 100,  8.0, '{"messages":5000,"tokensUsed":2000000}', 0),
  ('전설의 대화가','user', 4, '메시지 2만회, 1천만 토큰, 호감도 80 달성', 0, 100, 12.0, '{"messages":20000,"tokensUsed":10000000,"affinityMax":80}', 0);

-- 시드: 크리에이터 트랙 (혜택 = 수수료율 가산 %p). creator_tier_id NULL = 아직 크리에이터 아님
INSERT INTO chat_tiers (name, track, tier_rank, description, is_default, chat_cost, discount_rate, conditions, fee_bonus) VALUES
  ('신인 크리에이터', 'creator', 1, '첫 캐릭터 생성', 0, 0, 0, '{"createdCharacters":1}', 0),
  ('중견 크리에이터', 'creator', 2, '캐릭터 5개, 월드 1개 생성', 0, 0, 0, '{"createdCharacters":5,"createdWorlds":1}', 1.0),
  ('인기 크리에이터', 'creator', 3, '캐릭터 15개/월드 3개, 수수료 수익 1만 코인', 0, 0, 0, '{"createdCharacters":15,"createdWorlds":3,"feeEarned":10000}', 2.0),
  ('거장 크리에이터', 'creator', 4, '캐릭터 30개/월드 10개, 수수료 수익 10만 코인', 0, 0, 0, '{"createdCharacters":30,"createdWorlds":10,"feeEarned":100000}', 5.0);
