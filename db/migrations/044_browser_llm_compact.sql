-- 크롬 내장 AI(브라우저 레벨) 캐릭터별 허용 + 압축 프로필 (편집자가 수동 생성)
ALTER TABLE characters
  ADD COLUMN browser_llm_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER realtime_mode, -- 1=브라우저 AI 레벨 허용
  ADD COLUMN compact_prompt MEDIUMTEXT NULL AFTER browser_llm_enabled,              -- 브라우저 AI 용 압축 캐릭터 설정
  ADD COLUMN compact_prompt_hash VARCHAR(64) NULL AFTER compact_prompt;             -- 생성 당시 원본 설정 해시 (불일치 = 재생성 필요 표시)
