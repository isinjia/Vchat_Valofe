-- 제재 시스템: 유저(모든 채팅 금지/신규 채팅 금지)·캐릭터(기간제 비공개) 제재를 이력으로 기록.
--   사유 + 관리자 ID(관리자 인증 도입 전까지 NULL) + 기간 + 중도 해제(revoked_at).
--   활성 제재 = revoked_at IS NULL AND ends_at > NOW()
CREATE TABLE IF NOT EXISTS sanctions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target_type ENUM('user','character') NOT NULL,
  target_id   BIGINT UNSIGNED NOT NULL,
  -- user: chat_block(모든 채팅 금지) | new_chat_block(신규 채팅 시작 금지), character: hide(비공개)
  kind        ENUM('chat_block','new_chat_block','hide') NOT NULL,
  reason      VARCHAR(255) NULL,
  admin_id    BIGINT UNSIGNED NULL,   -- 제재한 관리자 (통합 관리자 인증 도입 시 기록)
  starts_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at     DATETIME NOT NULL,
  revoked_at  DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sanctions_target (target_type, target_id, ends_at)
) ENGINE=InnoDB;

-- 024 에서 임시로 추가한 캐릭터 컬럼은 sanctions 로 대체
ALTER TABLE characters DROP COLUMN suspended_until, DROP COLUMN suspend_reason;
