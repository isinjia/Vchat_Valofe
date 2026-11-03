-- 세계관 공유 기념일의 캐릭터별 오버라이드:
--   skip     = 이 캐릭터에는 그 기념일을 적용하지 않음 (사이 안 좋은 캐릭터의 생일 등)
--   override = 날짜/이름은 공유값 그대로, 설명(캐릭터의 태도)만 이 캐릭터 시점으로 덮어씀
CREATE TABLE IF NOT EXISTS character_anniversary_overrides (
  character_id BIGINT UNSIGNED NOT NULL,
  anniversary_id BIGINT UNSIGNED NOT NULL,
  mode ENUM('skip','override') NOT NULL DEFAULT 'skip',
  description TEXT NULL,  -- mode='override' 일 때 이 캐릭터 시점의 설명
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (character_id, anniversary_id),
  CONSTRAINT fk_cao_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT fk_cao_anniv FOREIGN KEY (anniversary_id) REFERENCES world_anniversaries(id) ON DELETE CASCADE
) ENGINE=InnoDB;
