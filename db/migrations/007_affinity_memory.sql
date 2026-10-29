-- 호감도 / 유저 팩트 (유저 x 캐릭터)
CREATE TABLE IF NOT EXISTS user_character_state (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  affinity INT NOT NULL DEFAULT 0,       -- -100 ~ 100
  facts JSON NULL,                        -- 유저 팩트 (짧은 문자열 배열, 최대 30)
  message_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ucs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ucs_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ucs (user_id, character_id)
) ENGINE=InnoDB;
