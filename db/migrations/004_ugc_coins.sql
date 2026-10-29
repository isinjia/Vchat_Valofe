-- 004: UGC 소유권/공개 모델 + 코인 경제
ALTER TABLE users
  ADD COLUMN coins BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN status ENUM('active','banned') NOT NULL DEFAULT 'active';

ALTER TABLE worlds
  ADD COLUMN owner_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN visibility ENUM('private','open') NOT NULL DEFAULT 'private',
  ADD COLUMN status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  ADD CONSTRAINT fk_worlds_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE characters
  ADD COLUMN owner_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN visibility ENUM('private','open') NOT NULL DEFAULT 'private',
  ADD COLUMN status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  ADD CONSTRAINT fk_chars_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE chat_tiers ADD COLUMN chat_cost INT NOT NULL DEFAULT 100; -- 메시지 1회 코인 비용

CREATE TABLE IF NOT EXISTS coin_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  amount BIGINT NOT NULL,                -- +지급 / -차감
  balance_after BIGINT NOT NULL,
  type ENUM('auto_topup','chat_spend','ai_assist_spend','illust_gen_spend','chat_fee_income','world_fee_income') NOT NULL,
  ref_type VARCHAR(32) NULL, ref_id BIGINT UNSIGNED NULL,
  memo VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ct_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ct_user (user_id, created_at)
) ENGINE=InnoDB;

-- 기존 데이터: 메인 화면이 계속 동작하도록 공개 처리 (owner 는 NULL = 운영 소유)
UPDATE worlds SET visibility='open';
UPDATE characters SET visibility='open';
