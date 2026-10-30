// 일러스트 trigger_condition 조립 (web/admin 공용 형태, 앱별 사본)
import { query } from "@vchatbot/core";

const REL = ["lover", "engaged", "married"] as const;

/** 조건의 requirePlaceId 가 해당 세계관의 location 사전 항목인지 검증. 문제 없으면 null, 있으면 에러 메시지 */
export async function validateTriggerPlace(triggerCondition: string | null, worldId: number): Promise<string | null> {
  if (!triggerCondition) return null;
  let placeId: number | undefined;
  try {
    placeId = (JSON.parse(triggerCondition) as { requirePlaceId?: number }).requirePlaceId;
  } catch {
    return null;
  }
  if (!placeId) return null;
  const rows = await query(
    "SELECT id FROM world_dictionary WHERE id = ? AND world_id = ? AND category = 'location'",
    [placeId, worldId]
  );
  return rows.length > 0 ? null : "지역 조건이 이 캐릭터의 세계관 지역사전에 없습니다.";
}

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
  requirePlaceId?: unknown;
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
  const requirePlaceId = posInt(input.requirePlaceId);
  const rel = input.requireRelationship;
  const requireRelationship = (REL as readonly unknown[]).includes(rel) ? (rel as string) : undefined;
  let minAffinity: number | undefined;
  if (input.minAffinity !== null && input.minAffinity !== undefined && input.minAffinity !== "") {
    const n = Number(input.minAffinity);
    if (!Number.isInteger(n) || n < -100 || n > 100) return { error: "호감도 조건은 -100~100 사이 정수여야 합니다." };
    minAffinity = n;
  }
  if (keywords.length === 0 && !requireEventId && !requireTierId && !requireRelationship && minAffinity === undefined && !requirePlaceId) {
    return { error: "조건부 일러스트는 트리거 키워드 또는 조건(이벤트/등급/관계/호감도/지역)이 하나 이상 필요합니다." };
  }
  return {
    value: JSON.stringify({
      type: "keyword",
      keywords,
      ...(requireEventId ? { requireEventId } : {}),
      ...(requireTierId ? { requireTierId } : {}),
      ...(requireRelationship ? { requireRelationship } : {}),
      ...(minAffinity !== undefined ? { minAffinity } : {}),
      ...(requirePlaceId ? { requirePlaceId } : {}),
    }),
  };
}
