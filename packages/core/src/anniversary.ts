/** 기념일 입력(프리셋/세계관 공통) 검증: 이름/설명 필수, 월 1~12, 일 1~31, 기간 1~60일 */
export function parseAnniversaryInput(body: unknown):
  | {
      value: {
        name: string;
        month: number;
        day: number;
        notice_days: number;
        duration_days: number;
        description: string;
      };
    }
  | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const description = typeof b.description === "string" ? b.description.trim() : "";
  const month = Number(b.month);
  const day = Number(b.day);
  const rawNotice = b.notice_days;
  const notice_days =
    rawNotice === undefined || rawNotice === null || rawNotice === "" || Number.isNaN(Number(rawNotice)) ? 7 : Number(rawNotice);
  const rawDuration = b.duration_days;
  const duration_days =
    rawDuration === undefined || rawDuration === null || rawDuration === "" || Number.isNaN(Number(rawDuration))
      ? 1
      : Number(rawDuration);
  if (!name || !description) return { error: "name, description 은 필수입니다." };
  if (name.length > 128) return { error: "name 은 128자 이하여야 합니다." };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: "month 는 1~12 여야 합니다." };
  if (!Number.isInteger(day) || day < 1 || day > 31) return { error: "day 는 1~31 이어야 합니다." };
  if (!Number.isInteger(notice_days) || notice_days < 0 || notice_days > 365) return { error: "notice_days 는 0~365 여야 합니다." };
  if (!Number.isInteger(duration_days) || duration_days < 1 || duration_days > 60) {
    return { error: "duration_days(기간)는 1~60일 이어야 합니다." };
  }
  return { value: { name, month, day, notice_days, duration_days, description } };
}

export interface AnniversaryOverride {
  anniversary_id: number;
  mode: "skip" | "override";
  /** mode='override' 일 때 이 캐릭터 시점의 설명 */
  description: string | null;
}

const OVERRIDE_DESC_MAX = 500;

/**
 * 공유 기념일 캐릭터별 오버라이드 입력 검증.
 * body: { overrides: [{ anniversary_id, skip?, description? }] }
 * skip 도 아니고 설명도 비어 있으면 "기본 적용"이므로 목록에서 제외(= 저장 안 함)한다.
 */
export function parseAnniversaryOverrides(body: unknown): { value: AnniversaryOverride[] } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.overrides)) return { error: "overrides 배열이 필요합니다." };
  const map = new Map<number, AnniversaryOverride>();
  for (const raw of b.overrides) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = Number(r.anniversary_id);
    if (!Number.isInteger(id) || id <= 0) return { error: "anniversary_id 가 올바르지 않습니다." };
    const skip = r.skip === true;
    const description = typeof r.description === "string" ? r.description.trim() : "";
    if (description.length > OVERRIDE_DESC_MAX) {
      return { error: `덮어쓰기 설명은 ${OVERRIDE_DESC_MAX}자 이하여야 합니다.` };
    }
    if (skip) map.set(id, { anniversary_id: id, mode: "skip", description: null });
    else if (description) map.set(id, { anniversary_id: id, mode: "override", description });
    else map.delete(id); // 기본 적용
  }
  return { value: [...map.values()] };
}
