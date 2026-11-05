-- 19금(성인) 설정: 세계관/캐릭터/스토리 플래그 + 유저 성인 여부 (vfun birthday 기반)
-- 상속 규칙: 세계관 19금 → 소속 캐릭터·스토리 자동 19금, 캐릭터 19금 → 소속 스토리 자동 19금 (유효값은 OR 로 계산)

ALTER TABLE worlds
  ADD COLUMN is_adult TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;

ALTER TABLE characters
  ADD COLUMN is_adult TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;

ALTER TABLE character_stories
  ADD COLUMN is_adult TINYINT(1) NOT NULL DEFAULT 0 AFTER like_count;

-- 유저: vfun /api/user 의 birthday 로 산출. is_adult NULL = 미확인 (birthday 미제공)
ALTER TABLE users
  ADD COLUMN birthday DATE NULL AFTER profile_image,
  ADD COLUMN is_adult TINYINT(1) NULL AFTER birthday;
