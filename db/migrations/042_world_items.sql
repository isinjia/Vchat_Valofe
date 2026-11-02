-- 세계관 선물 아이템: 채팅에서 코인으로 사용(선물)하면 호감도 효과가 적용된다
CREATE TABLE IF NOT EXISTS world_items (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  world_id   BIGINT UNSIGNED NOT NULL,
  name       VARCHAR(100) NOT NULL,
  description TEXT NULL,
  icon_key   VARCHAR(512) NULL,                 -- 아이콘 (목록/버튼용 작은 이미지)
  icon_url   VARCHAR(1024) NULL,
  image_key  VARCHAR(512) NULL,                 -- 큰 이미지 (선물 연출용)
  image_url  VARCHAR(1024) NULL,
  price      INT NOT NULL DEFAULT 0,            -- 사용(구매) 코인
  affinity_delta INT NOT NULL DEFAULT 0,        -- 기본 호감도 증감
  reset_affinity TINYINT(1) NOT NULL DEFAULT 0, -- 1 이면 호감도를 0으로 초기화 (증감보다 우선)
  cooldown_hours INT NOT NULL DEFAULT 0,        -- 같은 캐릭터에게 다시 쓰기까지 최소 텀(시간, 0=없음)
  max_uses_per_character INT NOT NULL DEFAULT 0,-- 캐릭터당 사용 가능 횟수 (0=무제한)
  char_rule  JSON NULL,                         -- 사용 가능/불가 캐릭터 {mode:'allow'|'deny', ids:[]} (NULL=전체 가능)
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_witem_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  INDEX idx_witem_world (world_id, is_active, sort_order)
) ENGINE=InnoDB;

-- 아이템의 캐릭터별 추가 호감도 보너스
CREATE TABLE IF NOT EXISTS world_item_characters (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id      BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  bonus_affinity INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_wic (item_id, character_id),
  CONSTRAINT fk_wic_item FOREIGN KEY (item_id) REFERENCES world_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_wic_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 아이템 사용(판매) 기록 — 판매지표/랭킹/사용정보의 원장
CREATE TABLE IF NOT EXISTS item_uses (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id      BIGINT UNSIGNED NULL,            -- 아이템 삭제 후에도 기록 유지 (SET NULL)
  item_name    VARCHAR(100) NOT NULL,           -- 스냅샷 (삭제 대비)
  world_id     BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  price        INT NOT NULL DEFAULT 0,          -- 사용 시점 가격 스냅샷
  affinity_applied INT NOT NULL DEFAULT 0,      -- 실제 적용된 호감도 증감 (초기화는 적용 후-전 차이)
  creator_fee  INT NOT NULL DEFAULT 0,          -- 캐릭터 제작자 수수료 스냅샷
  world_fee    INT NOT NULL DEFAULT 0,          -- 세계관 소유자 수수료 스냅샷
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_iu_item FOREIGN KEY (item_id) REFERENCES world_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_iu_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_iu_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  INDEX idx_iu_user (user_id, created_at),
  INDEX idx_iu_char (character_id, created_at),
  INDEX idx_iu_item (item_id, created_at),
  INDEX idx_iu_user_char_item (user_id, character_id, item_id, created_at),
  INDEX idx_iu_created (created_at)
) ENGINE=InnoDB;

-- 코인 거래 유형에 선물 아이템 차감 + 선물 수수료 수입 추가
ALTER TABLE coin_transactions
  MODIFY COLUMN type ENUM('auto_topup','chat_spend','ai_assist_spend','illust_gen_spend','video_gen_spend','gift_spend','chat_fee_income','gift_fee_income','world_fee_income') NOT NULL;
