-- 프로필 세트: 조건(계절/기념일 전후 기간/호감도)에 따라 채팅 아바타를 꾸미는 세트.
--   category 3종을 따로 지정하고, 충족한 세트를 배경 → 얼굴(감정별) → 효과 순으로 겹쳐 표시한다.
--   - background: 이미지 1장 (원 안 맨 아래)
--   - face: 감정별 투명배경 이미지 (character_profile_items)
--   - effect: 오버레이 1장 (원 밖까지 덮음, Animated GIF/APNG 지원, 배치값 effect_scale/x/y)
CREATE TABLE IF NOT EXISTS character_profile_sets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  category ENUM('background','face','effect') NOT NULL,
  name VARCHAR(100) NOT NULL,
  season ENUM('spring','summer','autumn','winter') NULL, -- 계절 조건 (NULL = 조건 없음)
  anniversary_id BIGINT UNSIGNED NULL,                   -- 기념일 조건 (world_anniversaries)
  days_before SMALLINT UNSIGNED NOT NULL DEFAULT 0,      -- 기념일 시작 N일 전부터
  days_after SMALLINT UNSIGNED NOT NULL DEFAULT 0,       -- 기념일 종료 N일 후까지
  min_affinity INT NULL,                                 -- 호감도 조건: 이 값 이상 (NULL = 조건 없음)
  emotion VARCHAR(16) NULL,                              -- 감정 조건 (effect 전용): 채점 감정이 일치할 때만
  bg_rule JSON NULL,                                     -- face 전용: 배경 호환 규칙 {mode:'allow'|'deny', ids:[배경세트id]} (NULL=전부 허용)
  storage_key VARCHAR(512) NULL,                         -- background/effect 의 단일 이미지
  url VARCHAR(1024) NULL,
  effect_scale DECIMAL(6,3) NOT NULL DEFAULT 1,          -- effect 배치: 원 지름=1 기준 가로 크기
  effect_x DECIMAL(6,3) NOT NULL DEFAULT 0,              -- effect 중심의 원 중심 대비 오프셋 (지름 단위)
  effect_y DECIMAL(6,3) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cps_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT fk_cps_anniv FOREIGN KEY (anniversary_id) REFERENCES world_anniversaries(id) ON DELETE SET NULL,
  INDEX idx_cps_char (character_id, category, sort_order)
) ENGINE=InnoDB;

-- 고급 프로필 사용 여부: OFF 면 세트 판정 없이 기존 기본 프로필만 사용
ALTER TABLE characters
  ADD COLUMN advanced_profile TINYINT(1) NOT NULL DEFAULT 0;

-- 얼굴세트의 감정별 이미지 (투명배경 권장)
CREATE TABLE IF NOT EXISTS character_profile_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  set_id BIGINT UNSIGNED NOT NULL,
  emotion VARCHAR(16) NOT NULL DEFAULT 'default',
  storage_key VARCHAR(512) NOT NULL,
  url VARCHAR(1024) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cpi (set_id, emotion),
  CONSTRAINT fk_cpi_set FOREIGN KEY (set_id) REFERENCES character_profile_sets(id) ON DELETE CASCADE
) ENGINE=InnoDB;
