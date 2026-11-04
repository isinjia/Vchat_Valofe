-- 스토리 타이틀 이미지 + 좋아요 (character_likes 와 동일한 토글+비정규화 집계 구조)
ALTER TABLE character_stories
  ADD COLUMN title_image_url VARCHAR(600) NULL AFTER title,
  ADD COLUMN like_count INT NOT NULL DEFAULT 0 AFTER status;

CREATE TABLE IF NOT EXISTS story_likes (
  user_id  BIGINT UNSIGNED NOT NULL,
  story_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, story_id),
  KEY idx_slikes_story (story_id),
  CONSTRAINT fk_slikes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_slikes_story FOREIGN KEY (story_id) REFERENCES character_stories(id) ON DELETE CASCADE
) ENGINE=InnoDB;
