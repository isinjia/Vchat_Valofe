-- 타이틀 이미지(3:4 세로형) + 인기순 정렬용 누적 대화 수
ALTER TABLE worlds
  ADD COLUMN title_image_key VARCHAR(512)  NULL AFTER ai_prompt,
  ADD COLUMN title_image_url VARCHAR(1024) NULL AFTER title_image_key;

ALTER TABLE characters
  ADD COLUMN title_image_key VARCHAR(512)  NULL AFTER ai_prompt,
  ADD COLUMN title_image_url VARCHAR(1024) NULL AFTER title_image_key,
  ADD COLUMN chat_count BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER title_image_url;
