-- 기념일 기간: 시작일(month/day)부터 duration_days 일간 이어지는 축제/행사형 기념일 지원
ALTER TABLE anniversary_presets ADD COLUMN duration_days SMALLINT NOT NULL DEFAULT 1 AFTER notice_days;
ALTER TABLE world_anniversaries ADD COLUMN duration_days SMALLINT NOT NULL DEFAULT 1 AFTER notice_days;
