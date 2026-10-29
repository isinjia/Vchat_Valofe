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
  preset_id BIGINT UNSIGNED NULL,     -- 출처 프리셋 (NULL = 그 세계관 커스텀)
  name VARCHAR(128) NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  day TINYINT UNSIGNED NOT NULL,
  description TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wa_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  CONSTRAINT fk_wa_preset FOREIGN KEY (preset_id) REFERENCES anniversary_presets(id) ON DELETE SET NULL,
  INDEX idx_wa_world (world_id, month, day)
) ENGINE=InnoDB;
