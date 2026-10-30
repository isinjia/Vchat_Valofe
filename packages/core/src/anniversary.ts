/** 기념일 입력(프리셋/세계관 공통) 검증: 이름/설명 필수, 월 1~12, 일 1~31 */
export function parseAnniversaryInput(
  body: unknown
): { value: { name: string; month: number; day: number; notice_days: number; description: string } } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const description = typeof b.description === "string" ? b.description.trim() : "";
  const month = Number(b.month);
  const day = Number(b.day);
  const rawNotice = b.notice_days;
  const notice_days =
    rawNotice === undefined || rawNotice === null || rawNotice === "" || Number.isNaN(Number(rawNotice)) ? 7 : Number(rawNotice);
  if (!name || !description) return { error: "name, description 은 필수입니다." };
  if (name.length > 128) return { error: "name 은 128자 이하여야 합니다." };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: "month 는 1~12 여야 합니다." };
  if (!Number.isInteger(day) || day < 1 || day > 31) return { error: "day 는 1~31 이어야 합니다." };
  if (!Number.isInteger(notice_days) || notice_days < 0 || notice_days > 365) return { error: "notice_days 는 0~365 여야 합니다." };
  return { value: { name, month, day, notice_days, description } };
}
