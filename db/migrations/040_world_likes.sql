-- 세계관 좋아요 (토글, worlds.like_count 로 집계) + 메인 세계 목록을 좋아요 순으로 정렬
CREATE TABLE IF NOT EXISTS world_likes (
  user_id    BIGINT UNSIGNED NOT NULL,
  world_id   BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, world_id),
  KEY idx_wlikes_world (world_id),
  CONSTRAINT fk_wlikes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_wlikes_world FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE worlds
  ADD COLUMN like_count INT NOT NULL DEFAULT 0 AFTER title_color;
