-- 영상 생성 AI 프로바이더 (OpenAI Sora / Gemini Veo / OpenAI 호환) — 관리자 > LLM 관리 > 영상 생성 AI 탭
CREATE TABLE IF NOT EXISTS video_providers (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(128) NOT NULL,
  provider   ENUM('openai','gemini','openai_compatible') NOT NULL DEFAULT 'openai',
  model      VARCHAR(128) NOT NULL,
  api_key    VARCHAR(512) NULL,
  base_url   VARCHAR(512) NULL,                         -- openai_compatible 용. 비우면 공식 엔드포인트
  size       VARCHAR(32) NOT NULL DEFAULT '720x1280',   -- openai: WxH, gemini: 가로:세로 비율로 자동 변환
  duration_seconds INT NOT NULL DEFAULT 8,              -- 생성 영상 길이(초)
  cost_per_video DECIMAL(12,4) NOT NULL DEFAULT 0,      -- 건당 비용 (예상 비용 표시용)
  cost_currency  VARCHAR(8) NOT NULL DEFAULT 'USD',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 캐릭터 일러스트에 영상 지원: media_type 구분 (image=기존, video=mp4/webm)
ALTER TABLE illustrations
  ADD COLUMN media_type ENUM('image','video') NOT NULL DEFAULT 'image' AFTER kind;

-- 코인 거래 유형에 영상 생성 차감 추가
ALTER TABLE coin_transactions
  MODIFY COLUMN type ENUM('auto_topup','chat_spend','ai_assist_spend','illust_gen_spend','video_gen_spend','chat_fee_income','world_fee_income') NOT NULL;
