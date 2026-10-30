-- 이미지 생성 AI 프로바이더 (OpenAI / Gemini / OpenAI 호환) — 관리자 > LLM 관리 > 이미지 생성 AI 탭
CREATE TABLE IF NOT EXISTS image_providers (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(128) NOT NULL,
  provider   ENUM('openai','gemini','openai_compatible') NOT NULL DEFAULT 'openai',
  model      VARCHAR(128) NOT NULL,
  api_key    VARCHAR(512) NULL,
  base_url   VARCHAR(512) NULL,                         -- openai_compatible 용. 비우면 공식 엔드포인트
  size       VARCHAR(32) NOT NULL DEFAULT '1024x1536',  -- openai: WxH, gemini: 가로:세로 비율로 자동 변환
  cost_per_image DECIMAL(12,4) NOT NULL DEFAULT 0,      -- 장당 비용 (예상 비용 표시용)
  cost_currency  VARCHAR(8) NOT NULL DEFAULT 'USD',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 기존 설정(app_settings.image_gen)에 API 키가 있으면 첫 프로바이더로 이관
INSERT INTO image_providers (name, provider, model, api_key, base_url, size, is_default, is_active)
SELECT '기존 이미지 생성 설정', 'openai_compatible',
       COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(value, '$.model')), 'null'), 'gpt-image-1'),
       JSON_UNQUOTE(JSON_EXTRACT(value, '$.apiKey')),
       COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(value, '$.baseUrl')), 'null'), 'https://api.openai.com/v1'),
       COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(value, '$.size')), 'null'), '1024x1536'),
       1,
       IF(JSON_UNQUOTE(JSON_EXTRACT(value, '$.enabled')) = 'true', 1, 0)
FROM app_settings
WHERE setting_key = 'image_gen'
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(value, '$.apiKey')), '') <> '';
