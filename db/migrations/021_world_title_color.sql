-- 세계관 타이틀 컬러: 캐릭터 카드 테두리/세계관 선택 시 배경 톤에 사용
ALTER TABLE worlds ADD COLUMN title_color VARCHAR(7) NULL AFTER title_image_url;
