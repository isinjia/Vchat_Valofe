-- 등급 우선 적용: 조건 충족 시 승급 사다리와 무관하게 최우선 적용 (강등 포함, 조건 해제 시 사다리로 복귀)
--   예: "제재 횟수 10회 이상" 등급을 is_override 로 만들면 다른 등급보다 우선한다
ALTER TABLE chat_tiers ADD COLUMN is_override TINYINT(1) NOT NULL DEFAULT 0 AFTER tier_rank;
