-- 관리권한 일시 정지: sanctions.kind 에 admin_block 추가 (로그인 시 차단, 이력 보존)
ALTER TABLE sanctions MODIFY COLUMN kind ENUM('chat_block','new_chat_block','hide','admin_block') NOT NULL;
