-- 호감도 구간별 반응 설정 + 실시간 대응 모드 + 장면 메모
-- (개발 DB 에는 이미 적용됨 — 새 환경 세팅용)

ALTER TABLE characters
  ADD COLUMN affinity_prompts JSON NULL AFTER greeting,          -- 호감도 구간별 반응 가이드 (비면 관리자 기본값 사용)
  ADD COLUMN realtime_mode TINYINT(1) NOT NULL DEFAULT 0 AFTER affinity_prompts; -- 1=실시간 대응 (오래 비우면 새 장면), 0=TRPG 식 장면 지속

ALTER TABLE user_character_state
  ADD COLUMN current_scene VARCHAR(300) NULL AFTER current_place_id; -- 현재 장면 한 줄 (자유 텍스트, 채점 LLM 이 매 턴 갱신)
