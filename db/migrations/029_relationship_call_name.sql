-- 유저-캐릭터 관계 상태(연인/약혼/결혼 — 이벤트 성공으로 켜짐)와 유저 호칭(캐릭터가 유저를 부르는 이름)
ALTER TABLE user_character_state
  ADD COLUMN relationship ENUM('none','lover','engaged','married') NOT NULL DEFAULT 'none' AFTER affinity,
  ADD COLUMN call_name VARCHAR(64) NULL AFTER relationship;
