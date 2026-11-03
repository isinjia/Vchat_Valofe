-- 스토리 모드: 캐릭터에 속한 분기형 시나리오 (기존 대화/이벤트 채팅과 별도).
-- 보드(노드/엣지/변수)는 JSON 통째 저장 — draft 는 미완성 허용, 공개 시 검증 후 published 로 복사.
-- 공개 후 draft 를 수정해도 플레이 중인 유저는 published_json 기준이라 깨지지 않는다.
CREATE TABLE IF NOT EXISTS character_stories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(100) NOT NULL,
  status ENUM('draft','published') NOT NULL DEFAULT 'draft',
  draft_json MEDIUMTEXT NOT NULL,
  published_json MEDIUMTEXT NULL,
  published_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cs_character (character_id),
  CONSTRAINT fk_cs_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 유저별 스토리 진행 상태 (유저×스토리당 1행 — 재시작하면 덮어쓰고 finished_count 만 누적)
CREATE TABLE IF NOT EXISTS user_story_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  story_id BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  status ENUM('active','finished') NOT NULL DEFAULT 'active',
  node_id VARCHAR(40) NOT NULL,
  vars_json TEXT NOT NULL,
  finished_count INT NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  UNIQUE KEY uq_usr_user_story (user_id, story_id),
  KEY idx_usr_story (story_id),
  CONSTRAINT fk_usr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_usr_story FOREIGN KEY (story_id) REFERENCES character_stories(id) ON DELETE CASCADE
) ENGINE=InnoDB;
