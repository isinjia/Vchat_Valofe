import { query, execute } from "./mysql";
import type { AiLevel } from "./types";

/** AI 레벨 목록 (level 오름차순) */
export async function listAiLevels(activeOnly = false): Promise<AiLevel[]> {
  return query<AiLevel>(
    `SELECT * FROM ai_levels ${activeOnly ? "WHERE is_active = 1" : ""} ORDER BY level`
  );
}

/**
 * 유저의 채팅 AI 레벨.
 * 선택한 레벨이 비활성/삭제됐으면 기본 레벨, 기본 레벨도 없으면 null (= 레거시 등급 동작).
 */
export async function resolveAiLevelForUser(userId: number): Promise<AiLevel | null> {
  const rows = await query<AiLevel>(
    `SELECT l.* FROM users u JOIN ai_levels l ON l.id = u.ai_level_id AND l.is_active = 1
     WHERE u.id = ?`,
    [userId]
  );
  if (rows.length > 0) return rows[0];
  const def = await query<AiLevel>(
    "SELECT * FROM ai_levels WHERE is_default = 1 AND is_active = 1 ORDER BY level LIMIT 1"
  );
  return def[0] ?? null;
}

/** 유저의 AI 레벨 선택 저장. null = 기본 레벨로 */
export async function setUserAiLevel(userId: number, levelId: number | null): Promise<void> {
  if (levelId != null) {
    const ok = await query("SELECT id FROM ai_levels WHERE id = ? AND is_active = 1", [levelId]);
    if (ok.length === 0) throw new Error("선택할 수 없는 AI 레벨입니다.");
  }
  await execute("UPDATE users SET ai_level_id = ? WHERE id = ?", [levelId, userId]);
}
