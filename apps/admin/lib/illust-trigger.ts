// 일러스트 trigger_condition 조립 (web/admin 공용 형태, 앱별 사본)
const REL = ["lover", "engaged", "married"] as const;

/**
 * 키워드/게이트 입력 → trigger_condition JSON 문자열.
 * 키워드 또는 게이트(이벤트/등급/관계/호감도) 중 하나 이상이 있어야 한다.
 */
export function buildIllustTrigger(input: {
  keywords?: unknown;
  requireEventId?: unknown;
  requireTierId?: unknown;
  requireRelationship?: unknown;
  minAffinity?: unknown;
}): { error: string } | { value: string } {
  const keywords = (typeof input.keywords === "string" ? input.keywords : "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const posInt = (v: unknown) => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const requireEventId = posInt(input.requireEventId);
  const requireTierId = posInt(input.requireTierId);
  const rel = input.requireRelationship;
  const requireRelationship = (REL as readonly unknown[]).includes(rel) ? (rel as string) : undefined;
  let minAffinity: number | undefined;
  if (input.minAffinity !== null && input.minAffinity !== undefined && input.minAffinity !== "") {
    const n = Number(input.minAffinity);
    if (!Number.isInteger(n) || n < -100 || n > 100) return { error: "호감도 조건은 -100~100 사이 정수여야 합니다." };
    minAffinity = n;
  }
  if (keywords.length === 0 && !requireEventId && !requireTierId && !requireRelationship && minAffinity === undefined) {
    return { error: "조건부 일러스트는 트리거 키워드 또는 조건(이벤트/등급/관계/호감도)이 하나 이상 필요합니다." };
  }
  return {
    value: JSON.stringify({
      type: "keyword",
      keywords,
      ...(requireEventId ? { requireEventId } : {}),
      ...(requireTierId ? { requireTierId } : {}),
      ...(requireRelationship ? { requireRelationship } : {}),
      ...(minAffinity !== undefined ? { minAffinity } : {}),
    }),
  };
}
