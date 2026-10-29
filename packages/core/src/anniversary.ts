/** 기념일 입력(프리셋/세계관 공통) 검증: 이름/설명 필수, 월 1~12, 일 1~31 */
export function parseAnniversaryInput(
  body: unknown
): { value: { name: string; month: number; day: number; description: string } } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const description = typeof b.description === "string" ? b.description.trim() : "";
  const month = Number(b.month);
  const day = Number(b.day);
  if (!name || !description) return { error: "name, description 은 필수입니다." };
  if (name.length > 128) return { error: "name 은 128자 이하여야 합니다." };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: "month 는 1~12 여야 합니다." };
  if (!Number.isInteger(day) || day < 1 || day > 31) return { error: "day 는 1~31 이어야 합니다." };
  return { value: { name, month, day, description } };
}
