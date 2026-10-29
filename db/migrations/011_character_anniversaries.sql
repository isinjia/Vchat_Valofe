-- 캐릭터 개인 기념일: character_id NULL = 세계관 공통, 값 = 그 캐릭터만 기억하는 날
ALTER TABLE world_anniversaries
  ADD COLUMN character_id BIGINT UNSIGNED NULL AFTER world_id,
  ADD CONSTRAINT fk_wa_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  ADD INDEX idx_wa_char (character_id, month, day);
