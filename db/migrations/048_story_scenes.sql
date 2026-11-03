-- 스토리 플레이 장면 캐시: 스토리 카드의 "장면 설정"으로 AI 가 생성한 대화 장면(캐릭터+플레이어 대사).
-- 유저×스토리×노드당 1회 생성 후 재사용 (다시 플레이해도 같은 장면 — LLM 비용 1회).
CREATE TABLE IF NOT EXISTS user_story_scenes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  story_id BIGINT UNSIGNED NOT NULL,
  node_id VARCHAR(40) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uss (user_id, story_id, node_id),
  CONSTRAINT fk_uss_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uss_story FOREIGN KEY (story_id) REFERENCES character_stories(id) ON DELETE CASCADE
) ENGINE=InnoDB;
