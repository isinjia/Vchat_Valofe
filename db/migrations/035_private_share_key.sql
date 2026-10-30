-- 비공개 캐릭터 링크 공유: 순번 URL 추측 방지용 랜덤 문자열.
--   스튜디오 '공유 링크 복사' 시 지연 생성. 비공개 캐릭터는 소유자가 아니면 /chat/{id}?k={share_key} 로만 입장.
ALTER TABLE characters ADD COLUMN share_key VARCHAR(32) NULL AFTER visibility;
