// 이벤트 채팅 설정 입력 검증 (web/admin 공용 형태, 앱별 사본)
const REL_TRIGGER = ["none", "lover", "engaged", "married"] as const;
const REL_SET = ["lover", "engaged", "married"] as const;

export type EventFields = {
  name: string;
  trigger_affinity_min: number | null;
  trigger_keywords: string | null;
  trigger_relationship: string | null;
  situation: string;
  success_condition: string;
  fail_condition: string | null;
  set_relationship: string | null;
  retry_hours: number;
  max_turns: number;
  is_active: number;
  success_line: string | null;
  success_illustration_id: number | null;
};

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** partial=true 면 body 에 있는 필드만 검증/반환 (PUT 부분 업데이트) */
export function parseEventInput(
  body: unknown,
  partial: boolean
): { error: string } | { value: Partial<EventFields> } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const v: Partial<EventFields> = {};
  const want = (k: string) => !partial || has(b, k);

  for (const [k, label] of [
    ["name", "이름"],
    ["situation", "상황 지시"],
    ["success_condition", "성공 조건"],
  ] as const) {
    if (want(k)) {
      const s = str(b[k]);
      if (!s) return { error: `${label}은(는) 필수입니다.` };
      if (k === "name" && s.length > 100) return { error: "이름은 100자 이하여야 합니다." };
      v[k] = s;
    }
  }
  if (want("trigger_affinity_min")) {
    const raw = b.trigger_affinity_min;
    if (raw === null || raw === undefined || raw === "") v.trigger_affinity_min = null;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n)) return { error: "호감도 조건은 정수여야 합니다." };
      v.trigger_affinity_min = n;
    }
  }
  if (want("trigger_keywords")) {
    const s = str(b.trigger_keywords)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .join(",");
    if (s.length > 255) return { error: "키워드는 255자 이하여야 합니다." };
    v.trigger_keywords = s || null;
  }
  if (want("trigger_relationship")) {
    const r = b.trigger_relationship;
    if (r === null || r === undefined || r === "") v.trigger_relationship = null;
    else if ((REL_TRIGGER as readonly unknown[]).includes(r)) v.trigger_relationship = r as string;
    else return { error: "관계 조건 값이 올바르지 않습니다." };
  }
  if (want("set_relationship")) {
    const r = b.set_relationship;
    if (r === null || r === undefined || r === "") v.set_relationship = null;
    else if ((REL_SET as readonly unknown[]).includes(r)) v.set_relationship = r as string;
    else return { error: "관계 설정 값이 올바르지 않습니다." };
  }
  if (want("fail_condition")) v.fail_condition = str(b.fail_condition) || null;
  if (want("retry_hours")) {
    const n = b.retry_hours === undefined || b.retry_hours === "" ? 72 : Number(b.retry_hours);
    if (!Number.isInteger(n) || n < 1 || n > 720) return { error: "재발동 텀은 1~720 시간이어야 합니다." };
    v.retry_hours = n;
  }
  if (want("max_turns")) {
    const n = b.max_turns === undefined || b.max_turns === "" ? 6 : Number(b.max_turns);
    if (!Number.isInteger(n) || n < 1 || n > 20) return { error: "최대 턴은 1~20 이어야 합니다." };
    v.max_turns = n;
  }
  if (want("success_line")) {
    const s = typeof b.success_line === "string" ? b.success_line.trim() : "";
    if (s.length > 2000) return { error: "달성 시 대사는 2000자 이하여야 합니다." };
    v.success_line = s || null;
  }
  if (want("success_illustration_id")) {
    const raw = b.success_illustration_id;
    if (raw === null || raw === undefined || raw === "") v.success_illustration_id = null;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) return { error: "달성 시 이미지 값이 올바르지 않습니다." };
      v.success_illustration_id = n;
    }
  }
  if (want("is_active")) v.is_active = b.is_active === false || b.is_active === 0 || b.is_active === "0" ? 0 : 1;
  return { value: v };
}
