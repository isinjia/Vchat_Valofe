-- 010: 캐릭터 관계를 인물사전(person) 기반으로 개편 + 인물사전 항목 ↔ 캐릭터 연결

-- 인물사전 항목 ↔ 실제 캐릭터 연결 (person 항목용)
ALTER TABLE world_dictionary
  ADD COLUMN linked_character_id BIGINT UNSIGNED NULL AFTER character_id,
  ADD CONSTRAINT fk_dict_linked_char FOREIGN KEY (linked_character_id) REFERENCES characters(id) ON DELETE SET NULL;

-- 관계 대상을 인물사전 항목으로
ALTER TABLE character_relationships
  ADD COLUMN target_entry_id BIGINT UNSIGNED NULL AFTER target_character_id,
  ADD CONSTRAINT fk_rel_entry FOREIGN KEY (target_entry_id) REFERENCES world_dictionary(id) ON DELETE CASCADE;

-- 기존 데이터 변환: 대상 캐릭터와 같은 이름의 person 사전 항목(세계관 공통)을 찾거나 만들어 연결
INSERT INTO world_dictionary (world_id, category, title, content, linked_character_id)
SELECT DISTINCT c.world_id, 'person', c.name, CONCAT(c.name, ' — ', LEFT(c.profile, 200)), c.id
FROM character_relationships r JOIN characters c ON c.id = r.target_character_id
WHERE NOT EXISTS (
  SELECT 1 FROM world_dictionary d
  WHERE d.world_id = c.world_id AND d.category='person' AND d.title = c.name AND d.character_id IS NULL
);

UPDATE character_relationships r
JOIN characters c ON c.id = r.target_character_id
JOIN world_dictionary d ON d.world_id = c.world_id AND d.category='person' AND d.title = c.name AND d.character_id IS NULL
SET r.target_entry_id = d.id;

-- 옛 컬럼 제거
ALTER TABLE character_relationships
  DROP FOREIGN KEY fk_rel_target,
  DROP INDEX uq_rel,
  DROP COLUMN target_character_id,
  ADD UNIQUE KEY uq_rel_entry (character_id, target_entry_id);

ALTER TABLE character_relationships MODIFY target_entry_id BIGINT UNSIGNED NOT NULL;
