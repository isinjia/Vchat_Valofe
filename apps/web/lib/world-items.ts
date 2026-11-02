import { query } from "@vchatbot/core";

export interface WorldItemInput {
  name: string;
  description: string | null;
  price: number;
  affinity_delta: number;
  reset_affinity: 0 | 1;
  cooldown_hours: number;
  max_uses_per_character: number;
  char_rule: string | null;
  /** 캐릭터별 추가 호감도 보너스 */
  bonuses: { characterId: number; bonus: number }[];
  sort_order: number;
  is_active: 0 | 1;
}

/** 선물 아이템 생성/수정 입력 검증. 보너스/사용규칙 캐릭터는 이 세계관 소속이어야 한다. */
export async function parseWorldItemInput(
  body: unknown,
  worldId: number
): Promise<{ value: WorldItemInput } | { error: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { error: "아이템 이름이 필요합니다." };
  if (name.length > 100) return { error: "아이템 이름은 100자 이하여야 합니다." };
  const description = typeof b.description === "string" && b.description.trim() ? b.description.trim() : null;

  const intIn = (v: unknown, min: number, max: number, label: string): number | { error: string } => {
    const n = Number(v ?? 0);
    if (!Number.isInteger(n) || n < min || n > max) return { error: `${label}은(는) ${min}~${max} 사이 정수여야 합니다.` };
    return n;
  };
  const price = intIn(b.price, 0, 1_000_000, "가격");
  if (typeof price === "object") return price;
  const affinityDelta = intIn(b.affinityDelta ?? b.affinity_delta, -100, 100, "호감도 증감");
  if (typeof affinityDelta === "object") return affinityDelta;
  const cooldown = intIn(b.cooldownHours ?? b.cooldown_hours, 0, 720, "최소 텀(시간)");
  if (typeof cooldown === "object") return cooldown;
  const maxUses = intIn(b.maxUses ?? b.max_uses_per_character, 0, 10_000, "사용 가능 횟수");
  if (typeof maxUses === "object") return maxUses;
  const sortOrder = intIn(b.sortOrder ?? b.sort_order ?? 0, -10_000, 10_000, "정렬 순서");
  if (typeof sortOrder === "object") return sortOrder;

  const resetAffinity = b.resetAffinity === true || b.reset_affinity === 1 || b.reset_affinity === true ? 1 : 0;
  const isActive = b.isActive === false || b.is_active === 0 || b.is_active === false ? 0 : 1;

  // 세계관 소속 캐릭터 검증 헬퍼
  const validChars = async (ids: number[]): Promise<boolean> => {
    if (ids.length === 0) return true;
    const rows = await query<{ id: number }>(
      `SELECT id FROM characters WHERE world_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
      [worldId, ...ids]
    );
    return rows.length === ids.length;
  };
  const idList = (raw: unknown) =>
    [...new Set((Array.isArray(raw) ? raw : []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);

  // 사용 가능/불가 캐릭터 규칙
  let charRule: string | null = null;
  const mode = b.charMode == null || b.charMode === "" ? "all" : String(b.charMode);
  if (mode !== "all") {
    if (mode !== "allow" && mode !== "deny") return { error: "charMode 는 all/allow/deny 중 하나여야 합니다." };
    const ids = idList(b.charIds);
    if (ids.length === 0) return { error: "사용 가능/불가로 지정할 캐릭터를 하나 이상 선택하세요." };
    if (!(await validChars(ids))) return { error: "이 세계관의 캐릭터가 아닌 항목이 있습니다." };
    charRule = JSON.stringify({ mode, ids });
  }

  // 캐릭터별 추가 보너스
  const bonuses: { characterId: number; bonus: number }[] = [];
  if (Array.isArray(b.bonuses)) {
    const seen = new Set<number>();
    for (const row of b.bonuses as { characterId?: unknown; bonus?: unknown }[]) {
      const cid = Number(row?.characterId);
      const bonus = Number(row?.bonus);
      if (!Number.isInteger(cid) || cid <= 0) continue;
      if (!Number.isInteger(bonus) || bonus < -100 || bonus > 100) {
        return { error: "캐릭터 보너스 호감도는 -100~100 사이 정수여야 합니다." };
      }
      if (seen.has(cid)) continue;
      seen.add(cid);
      bonuses.push({ characterId: cid, bonus });
    }
    if (!(await validChars(bonuses.map((x) => x.characterId)))) {
      return { error: "보너스 대상에 이 세계관의 캐릭터가 아닌 항목이 있습니다." };
    }
  }

  return {
    value: {
      name,
      description,
      price,
      affinity_delta: affinityDelta,
      reset_affinity: resetAffinity as 0 | 1,
      cooldown_hours: cooldown,
      max_uses_per_character: maxUses,
      char_rule: charRule,
      bonuses,
      sort_order: sortOrder,
      is_active: isActive as 0 | 1,
    },
  };
}
