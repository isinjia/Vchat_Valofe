-- 캐릭터 좋아요: 토글 + 집계(like_count 비정규화) + 좋아요순 정렬
CREATE TABLE IF NOT EXISTS character_likes (
  user_id      BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, character_id),
  KEY idx_clikes_character (character_id),
  CONSTRAINT fk_clikes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_clikes_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE characters ADD COLUMN like_count INT NOT NULL DEFAULT 0 AFTER chat_count;
