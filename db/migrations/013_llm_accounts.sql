-- LLM 멀티 계정 + 월 쿼터
CREATE TABLE IF NOT EXISTS llm_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  llm_provider_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(128) NOT NULL,
  api_key VARCHAR(512) NULL,
  monthly_token_limit BIGINT NOT NULL DEFAULT 0,  -- 월 토큰 한도(입력+출력 합). 0 = 무제한
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lacc_provider FOREIGN KEY (llm_provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS llm_account_usage (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  llm_account_id BIGINT UNSIGNED NOT NULL,
  month CHAR(7) NOT NULL,  -- 'YYYY-MM' (UTC)
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  request_count BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT fk_laccu_account FOREIGN KEY (llm_account_id) REFERENCES llm_accounts(id) ON DELETE CASCADE,
  UNIQUE KEY uq_account_month (llm_account_id, month)
) ENGINE=InnoDB;
