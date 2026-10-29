-- vfun KR 인증 연동: users 에 vfun 회원 식별 컬럼 추가
ALTER TABLE users
  ADD COLUMN vfun_u_no BIGINT UNSIGNED NULL,
  ADD COLUMN vfun_user_id VARCHAR(128) NULL,
  ADD COLUMN profile_image VARCHAR(1024) NULL,
  ADD UNIQUE KEY uq_users_vfun (vfun_u_no);
