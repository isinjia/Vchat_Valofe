-- 관리툴 vfun 로그인 + 관리자 등급 + 감사 로그
--   admin_role: user_admin(대시보드/조회/제재만) | system_admin(전체). NULL = 관리툴 접근 불가
ALTER TABLE users ADD COLUMN admin_role ENUM('user_admin','system_admin') NULL AFTER role;

CREATE TABLE IF NOT EXISTS admin_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  method VARCHAR(8) NOT NULL,
  path VARCHAR(512) NOT NULL,
  detail TEXT NULL,                      -- 요청 본문 발췌 (api_key/password 는 마스킹)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_alogs_admin (admin_user_id, id),
  CONSTRAINT fk_alogs_user FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 초기 시스템 관리자: nexontest
UPDATE users SET admin_role = 'system_admin' WHERE vfun_user_id = 'nexontest';
