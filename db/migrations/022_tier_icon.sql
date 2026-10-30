-- 등급 아이콘: 이모지 또는 이미지 URL. 상단바 유저 등급 표시에 사용
ALTER TABLE chat_tiers ADD COLUMN icon VARCHAR(255) NULL AFTER name;
