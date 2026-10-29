-- 채팅 오프닝: 대화 시작 상황 설정 + 제작자 첫 인사말
ALTER TABLE characters
  ADD COLUMN scenario MEDIUMTEXT NULL AFTER ai_prompt,   -- 대화 시작 상황 설정
  ADD COLUMN greeting MEDIUMTEXT NULL AFTER scenario;    -- 제작자가 쓴 첫 인사말
