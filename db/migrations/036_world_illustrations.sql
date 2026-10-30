-- 세계관 일러스트: 지역사전(location) 항목별 배경 이미지 여러 장 (dict_entry_id NULL = 세계관 공통 배경)
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

-- 현재 장면의 지역 (채점 LLM 이 지역사전 후보 중에서 식별 — 일러스트 지역 게이트용)
ALTER TABLE user_character_state
  ADD COLUMN current_place_id BIGINT UNSIGNED NULL AFTER call_name,
  ADD CONSTRAINT fk_ucs_place FOREIGN KEY (current_place_id) REFERENCES world_dictionary(id) ON DELETE SET NULL;
