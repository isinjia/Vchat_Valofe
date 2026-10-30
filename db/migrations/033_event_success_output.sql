-- 이벤트 달성 시 고정 대사(success_line)와 출력 이미지(success_illustration_id) 지정
ALTER TABLE character_events
  ADD COLUMN success_line TEXT NULL AFTER set_relationship,
  ADD COLUMN success_illustration_id BIGINT UNSIGNED NULL AFTER success_line,
  ADD CONSTRAINT fk_cev_sill FOREIGN KEY (success_illustration_id) REFERENCES illustrations(id) ON DELETE SET NULL;
