-- 이벤트 채팅 발동 조건에 "선행 이벤트 성공" 추가.
-- 지정하면 같은 캐릭터의 해당 이벤트를 성공한 유저에게만 발동한다 (이벤트 체인).
ALTER TABLE character_events
  ADD COLUMN trigger_prereq_event_id BIGINT UNSIGNED NULL AFTER trigger_relationship,
  ADD CONSTRAINT fk_cev_prereq FOREIGN KEY (trigger_prereq_event_id)
    REFERENCES character_events(id) ON DELETE SET NULL;
