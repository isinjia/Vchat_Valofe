import { query, execute } from "./mysql";

/** 세계관 선물 아이템 행 */
export interface WorldItemRow {
  id: number;
  world_id: number;
  name: string;
  description: string | null;
  icon_key: string | null;
  icon_url: string | null;
  image_key: string | null;
  image_url: string | null;
  price: number;
  affinity_delta: number;
  /** 1 이면 호감도를 0으로 초기화 (증감보다 우선) */
  reset_affinity: number;
  cooldown_hours: number;
  max_uses_per_character: number;
  /** 사용 가능/불가 캐릭터 {mode:'allow'|'deny', ids:[]} (NULL=전체 가능) */
  char_rule: { mode: "allow" | "deny"; ids: number[] } | string | null;
  is_active: number;
  sort_order: number;
  created_at: string;
}

/** 아이템의 사용 가능/불가 캐릭터 규칙 해석 — 규칙 없으면 전체 가능 */
export function itemAllowedForCharacter(rule: WorldItemRow["char_rule"], characterId: number): boolean {
  if (rule == null) return true;
  let r: { mode?: string; ids?: unknown };
  try {
    r = typeof rule === "string" ? JSON.parse(rule) : rule;
  } catch {
    return true;
  }
  const ids = Array.isArray(r?.ids) ? r.ids.map(Number) : [];
  if (r?.mode === "allow") return ids.includes(characterId);
  if (r?.mode === "deny") return !ids.includes(characterId);
  return true;
}

/**
 * 선물 효과 적용: reset 이면 호감도 0, 아니면 기본 증감 + 캐릭터 보너스 (−100~100 클램프).
 * 반환: 적용 전/후 호감도.
 */
export async function applyGiftAffinity(
  userId: number,
  characterId: number,
  item: Pick<WorldItemRow, "affinity_delta" | "reset_affinity">,
  bonus: number
): Promise<{ before: number; after: number }> {
  const rows = await query<{ affinity: number }>(
    "SELECT affinity FROM user_character_state WHERE user_id = ? AND character_id = ?",
    [userId, characterId]
  );
  const before = Number(rows[0]?.affinity ?? 0);
  const after = item.reset_affinity
    ? 0
    : Math.max(-100, Math.min(100, before + Number(item.affinity_delta) + bonus));
  await execute(
    `INSERT INTO user_character_state (user_id, character_id, affinity)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE affinity = VALUES(affinity)`,
    [userId, characterId, after]
  );
  return { before, after };
}
