-- 업로드 용량 제한의 크리에이터 등급별 차등 (NULL = 관리자 설정의 전역 기본값 사용)
--   영상(일러스트)·효과(프로필 GIF/APNG) 업로드 최대 용량 (MB)
ALTER TABLE chat_tiers
  ADD COLUMN video_max_mb INT NULL AFTER fee_bonus,
  ADD COLUMN effect_max_mb INT NULL AFTER video_max_mb;
