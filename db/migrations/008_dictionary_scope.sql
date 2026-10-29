-- 사전 항목 범위 구분: character_id NULL = 세계관 공통, 값 있으면 해당 캐릭터 전용 지식
ALTER TABLE world_dictionary
  ADD COLUMN character_id BIGINT UNSIGNED NULL AFTER world_id,
  ADD CONSTRAINT fk_dict_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  ADD INDEX idx_dict_world_char (world_id, character_id);
