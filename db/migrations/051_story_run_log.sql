-- 스토리 플레이 로그: 지나온 장면/선택 경로를 기록해 재접속 시 채팅 로그 전체를 복원한다.
-- (장면 캐시 user_story_scenes 는 "다시 시작" 시 삭제되어 새 런에서는 장면을 AI 가 새로 생성한다)
ALTER TABLE user_story_runs
  ADD COLUMN log_json MEDIUMTEXT NULL AFTER vars_json;
