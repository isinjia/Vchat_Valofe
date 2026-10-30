-- 관리자 기간제 제재: 캐릭터를 N일간 비공개(채팅/노출 차단). 기간이 지나면 자동 해제
ALTER TABLE characters
  ADD COLUMN suspended_until DATETIME NULL AFTER status,
  ADD COLUMN suspend_reason VARCHAR(255) NULL AFTER suspended_until;
