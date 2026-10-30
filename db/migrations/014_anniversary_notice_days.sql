-- 기념일별 언급 시작 일수 (기념일 N일 전부터 언급, 0 = 당일만)
ALTER TABLE anniversary_presets ADD COLUMN notice_days TINYINT UNSIGNED NOT NULL DEFAULT 7 AFTER day;
ALTER TABLE world_anniversaries ADD COLUMN notice_days TINYINT UNSIGNED NOT NULL DEFAULT 7 AFTER day;
