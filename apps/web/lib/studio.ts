import { NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

/** 스튜디오 API 공통: 로그인 필수. 비로그인이면 401 응답을 반환 */
export async function requireUser(): Promise<{ userId: number } | { res: NextResponse }> {
  const userId = await getUserId();
  if (userId == null) return { res: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  return { userId };
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

type OwnerRow = { owner_user_id: number | null } & Record<string, unknown>;

/** 소유권 검사: 없으면 404, 내 것이 아니면 403 */
async function ownedRow(
  table: "worlds" | "characters",
  id: string | number,
  userId: number
): Promise<{ row: OwnerRow } | { res: NextResponse }> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { res: bad("id 가 올바르지 않습니다.") };
  const rows = await query<OwnerRow>(`SELECT * FROM ${table} WHERE id = ?`, [n]);
  if (rows.length === 0) return { res: bad("찾을 수 없습니다.", 404) };
  if (rows[0].owner_user_id !== userId) return { res: bad("권한이 없습니다.", 403) };
  return { row: rows[0] };
}

export const ownedWorld = (id: string | number, userId: number) => ownedRow("worlds", id, userId);
export const ownedCharacter = (id: string | number, userId: number) => ownedRow("characters", id, userId);

/** 캐릭터가 사용할 수 있는 세계관인지: 내 세계관이거나 open+active 세계관 */
export async function canUseWorld(worldId: unknown, userId: number): Promise<boolean> {
  const n = Number(worldId);
  if (!Number.isInteger(n) || n <= 0) return false;
  const rows = await query(
    `SELECT id FROM worlds
     WHERE id = ? AND (owner_user_id = ? OR (visibility = 'open' AND status = 'active'))`,
    [n, userId]
  );
  return rows.length > 0;
}

/**
 * 공유 세계관 작성 범위 검증: 내 세계관이 아니고 open_scope='dict_person' 이면
 * 공용 인명사전(person) 표제어와 이름이 정확히 일치해야 한다. 위반 시 에러 메시지, 통과 시 null.
 */
export async function checkWorldNameScope(worldId: unknown, userId: number, name: string): Promise<string | null> {
  const n = Number(worldId);
  const w = await query("SELECT owner_user_id, open_scope FROM worlds WHERE id = ?", [n]);
  if (w.length === 0) return null;
  const row = w[0] as { owner_user_id: number | null; open_scope: string };
  if (row.owner_user_id === userId || row.open_scope !== "dict_person") return null;
  const hit = await query(
    "SELECT id FROM world_dictionary WHERE world_id = ? AND character_id IS NULL AND category = 'person' AND title = ? LIMIT 1",
    [n, name]
  );
  return hit.length > 0 ? null : "이 세계관은 인명사전에 있는 인물 이름으로만 캐릭터를 만들 수 있습니다.";
}

/**
 * 사전 항목 범위 검증 (스튜디오): null/미지정=세계관 공통,
 * 값 있음 → 내 소유(403) + 해당 세계관 소속(400) 캐릭터여야 함
 */
export async function resolveOwnCharacterScope(
  worldId: string | number,
  raw: unknown,
  userId: number
): Promise<{ characterId: number | null } | { res: NextResponse }> {
  if (raw === null || raw === undefined || raw === "") return { characterId: null };
  const own = await ownedCharacter(raw as string | number, userId);
  if ("res" in own) return own;
  if (Number(own.row.world_id) !== Number(worldId)) return { res: bad("해당 세계관에 속한 캐릭터가 아닙니다.") };
  return { characterId: Number(own.row.id) };
}

export const visibilityOf = (v: unknown): "open" | "private" => (v === "open" ? "open" : "private");
