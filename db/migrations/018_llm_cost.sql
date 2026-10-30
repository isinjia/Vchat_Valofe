-- LLM 토큰 단가 (예상 AI 사용 비용 표시용)
ALTER TABLE llm_providers
  ADD COLUMN cost_per_1m_input  DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER max_tokens,
  ADD COLUMN cost_per_1m_output DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER cost_per_1m_input,
  ADD COLUMN cost_currency      VARCHAR(8) NOT NULL DEFAULT 'USD' AFTER cost_per_1m_output;

-- 프로바이더 단위 월 사용량 (계정 미등록 호출 포함 — 예상 비용 집계용)
CREATE TABLE IF NOT EXISTS llm_provider_usage (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  llm_provider_id BIGINT UNSIGNED NOT NULL,
  month CHAR(7) NOT NULL,  -- 'YYYY-MM' (UTC)
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  request_count BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT fk_lpu_provider FOREIGN KEY (llm_provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE,
  UNIQUE KEY uq_provider_month (llm_provider_id, month)
) ENGINE=InnoDB;
