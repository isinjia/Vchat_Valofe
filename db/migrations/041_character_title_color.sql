-- 캐릭터 타이틀 컬러: 카드 테두리·채팅 배경 톤에 사용 (NULL = 세계관 타이틀 컬러 따름)
ALTER TABLE characters
  ADD COLUMN title_color VARCHAR(7) NULL AFTER title_image_url;
