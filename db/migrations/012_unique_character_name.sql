-- 캐릭터 이름은 세계관 내에서 중복 불가
ALTER TABLE characters ADD UNIQUE KEY uq_char_world_name (world_id, name);
