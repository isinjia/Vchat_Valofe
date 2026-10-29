import { query } from "@vchatbot/core";

/**
 * 사전 항목 범위(character_id) 검증.
 * - 미지정/null/"" → 세계관 공통(null)
 * - 값 있음 → 해당 캐릭터가 이 세계관 소속이어야 함
 */
export async function resolveCharacterScope(
  worldId: string | number,
  raw: unknown
): Promise<{ characterId: number | null } | { error: string }> {
  if (raw === null || raw === undefined || raw === "") return { characterId: null };
  const cid = Number(raw);
  if (!Number.isInteger(cid) || cid <= 0) return { error: "character_id 가 올바르지 않습니다." };
  const rows = await query("SELECT id FROM characters WHERE id = ? AND world_id = ?", [cid, Number(worldId)]);
  if (rows.length === 0) return { error: "해당 세계관에 속한 캐릭터가 아닙니다." };
  return { characterId: cid };
}
