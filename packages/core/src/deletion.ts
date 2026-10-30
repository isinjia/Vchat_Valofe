import { query, execute } from "./mysql";
import { invalidateChatContext } from "./repository";
import { invalidateCachePattern } from "./cache";

/** 삭제 대기 기간 (일) */
export const DELETE_GRACE_DAYS = 3;

export type DeletableKind = "world" | "character";

const TABLE: Record<DeletableKind, string> = { world: "worlds", character: "characters" };

/**
 * 이름 확인 후 삭제 대기 등록. 이름이 일치하지 않으면 Error.
 * ownerUserId 를 주면 소유자 조건을 함께 건다 (스튜디오용).
 */
export async function scheduleDeletion(
  kind: DeletableKind,
  id: number,
  confirmName: string,
  ownerUserId?: number
): Promise<{ scheduledAt: Date }> {
  const rows = await query<{ id: number; name: string }>(
    `SELECT id, name FROM ${TABLE[kind]} WHERE id = ?${ownerUserId ? " AND owner_user_id = ?" : ""}`,
    ownerUserId ? [id, ownerUserId] : [id]
  );
  if (rows.length === 0) throw new Error("대상을 찾을 수 없습니다.");
  if (rows[0].name.trim() !== confirmName.trim()) {
    throw new Error("이름이 일치하지 않습니다. 정확히 입력해 주세요.");
  }
  const scheduledAt = new Date(Date.now() + DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  await execute(`UPDATE ${TABLE[kind]} SET delete_scheduled_at = ? WHERE id = ?`, [scheduledAt, id]);
  await invalidatePublicCaches(kind === "character" ? id : undefined);
  return { scheduledAt };
}

/** 삭제 대기 취소 */
export async function cancelDeletion(kind: DeletableKind, id: number, ownerUserId?: number): Promise<void> {
  await execute(
    `UPDATE ${TABLE[kind]} SET delete_scheduled_at = NULL WHERE id = ?${ownerUserId ? " AND owner_user_id = ?" : ""}`,
    ownerUserId ? [id, ownerUserId] : [id]
  );
  await invalidatePublicCaches(kind === "character" ? id : undefined);
}

/**
 * 만기가 지난 삭제 대기 행을 실제 삭제한다 (lazy sweep — 목록 API 등에서 호출).
 * 세계관을 먼저 지우면 소속 캐릭터는 FK CASCADE 로 함께 삭제된다. 실패해도 throw 하지 않음.
 */
export async function sweepScheduledDeletions(): Promise<void> {
  try {
    const dueWorlds = await query<{ id: number }>(
      "SELECT id FROM worlds WHERE delete_scheduled_at IS NOT NULL AND delete_scheduled_at <= NOW()"
    );
    const dueChars = await query<{ id: number }>(
      "SELECT id FROM characters WHERE delete_scheduled_at IS NOT NULL AND delete_scheduled_at <= NOW()"
    );
    if (dueWorlds.length === 0 && dueChars.length === 0) return;
    if (dueWorlds.length > 0) {
      await execute(`DELETE FROM worlds WHERE id IN (${dueWorlds.map(() => "?").join(",")})`,
        dueWorlds.map((w) => w.id));
    }
    if (dueChars.length > 0) {
      // 세계관 CASCADE 로 이미 지워진 캐릭터는 영향 0행으로 무시된다
      await execute(`DELETE FROM characters WHERE id IN (${dueChars.map(() => "?").join(",")})`,
        dueChars.map((c) => c.id));
    }
    await invalidatePublicCaches();
  } catch (e) {
    console.error("sweepScheduledDeletions error:", e);
  }
}

async function invalidatePublicCaches(characterId?: number): Promise<void> {
  try {
    await invalidateChatContext(characterId);
    await invalidateCachePattern("cache:web:chars:*");
    await invalidateCachePattern("cache:web:worlds");
  } catch {
    // 캐시 실패는 무시
  }
}
