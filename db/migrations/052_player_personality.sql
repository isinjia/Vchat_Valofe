-- 플레이어(유저) 성격 타입: 가입(첫 로그인) 시 선택 받아 저장.
-- 스토리 플레이 장면 생성 때 플레이어 대사의 말투를 고정하는 데 쓴다 (실제 채팅 대사 샘플과 함께).
ALTER TABLE users
  ADD COLUMN personality_type VARCHAR(20) NULL AFTER is_adult;
