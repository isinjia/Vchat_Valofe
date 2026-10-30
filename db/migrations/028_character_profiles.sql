-- 캐릭터 프로필 이미지 (원형, 채팅 말풍선 앞 표시). emotion='default' 는 기본,
-- 감정 키(joy/sad/angry/shy/surprised/love/neutral)별로 등록하면 채점된 감정에 따라 교체된다
CREATE TABLE IF NOT EXISTS character_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  emotion VARCHAR(16) NOT NULL DEFAULT 'default',
  storage_key VARCHAR(512) NOT NULL,
  url VARCHAR(1024) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cprof (character_id, emotion),
  CONSTRAINT fk_cprof_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB;
