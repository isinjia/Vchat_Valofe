-- 스튜디오 AI 보조 BYOK: 유저 본인 Claude API 키 (등록 시 보조 생성이 본인 키로 호출되고 코인은 정액 차감)
ALTER TABLE users ADD COLUMN claude_api_key VARCHAR(255) NULL AFTER profile_image;
