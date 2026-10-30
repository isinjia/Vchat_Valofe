-- 이벤트 채팅: 조건 발동 → 이벤트 상황 대화 → 성공/실패 판정 → 달성 저장.
--   실패 시 retry_hours 가 지나야 재발동. 성공 시 set_relationship 로 관계 플래그를 켤 수 있다.
CREATE TABLE IF NOT EXISTS character_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  -- 발동 조건 (NULL 인 항목은 무시, 지정된 항목은 모두 충족해야 발동)
  trigger_affinity_min INT NULL,                        -- 호감도 N 이상
  trigger_keywords VARCHAR(255) NULL,                   -- 쉼표 구분, 유저 메시지에 하나라도 포함
  trigger_relationship ENUM('none','lover','engaged','married') NULL, -- 현재 관계가 이 값일 때만
  situation TEXT NOT NULL,                              -- 이벤트 상황 지시 (프롬프트 주입)
  success_condition TEXT NOT NULL,                      -- 성공 판정 기준
  fail_condition TEXT NULL,                             -- 명시적 실패 기준 (없으면 턴 초과 시만 실패)
  set_relationship ENUM('lover','engaged','married') NULL, -- 성공 시 켤 관계 플래그
  retry_hours INT NOT NULL DEFAULT 72,                  -- 실패 후 재발동 대기(시간)
  max_turns INT NOT NULL DEFAULT 6,                     -- 최대 진행 턴 (초과 시 실패)
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cev_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 유저별 이벤트 진행/달성 이력
CREATE TABLE IF NOT EXISTS user_character_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  event_id BIGINT UNSIGNED NOT NULL,
  status ENUM('active','success','failed') NOT NULL DEFAULT 'active',
  turns INT NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  KEY idx_uce_user (user_id, character_id, status),
  KEY idx_uce_event (event_id, user_id, status),
  CONSTRAINT fk_uce_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uce_event FOREIGN KEY (event_id) REFERENCES character_events(id) ON DELETE CASCADE
) ENGINE=InnoDB;
