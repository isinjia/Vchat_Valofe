-- 세계관/캐릭터 삭제 대기: 이름 확인 후 3일 뒤 실제 삭제 (그 전까지 취소 가능)
ALTER TABLE worlds     ADD COLUMN delete_scheduled_at DATETIME NULL AFTER status;
ALTER TABLE characters ADD COLUMN delete_scheduled_at DATETIME NULL AFTER status;
