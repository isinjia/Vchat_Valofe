import { query, execute } from "./mysql";
import { invalidateChatContext } from "./repository";
import { invalidateCachePattern } from "./cache";
import type { SanctionRow } from "./types";

export type SanctionKind = SanctionRow["kind"];

export const SANCTION_KIND_LABELS: Record<SanctionKind, string> = {
  chat_block: "모든 채팅 금지",
  new_chat_block: "신규 채팅 시작 금지",
  hide: "비공개 (노출/채팅 차단)",
  admin_block: "관리권한 일시 정지",
};

/** 제재 등록. adminId 는 통합 관리자 인증 도입 전까지 null */
export async function addSanction(input: {
  targetType: "user" | "character";
  targetId: number;
  kind: SanctionKind;
  days: number;
  reason?: string | null;
  adminId?: number | null;
}): Promise<{ id: number; endsAt: Date }> {
  const days = Math.min(365, Math.max(1, Math.floor(input.days)));
  const endsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const result = await execute(
    `INSERT INTO sanctions (target_type, target_id, kind, reason, admin_id, ends_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.targetType, input.targetId, input.kind, input.reason?.trim() || null, input.adminId ?? null, endsAt]
  );
  await invalidateSanctionCaches(input.targetType, input.targetId);
  return { id: result.insertId, endsAt };
}

/** 제재 중도 해제 (이력은 보존) */
export async function revokeSanction(id: number): Promise<void> {
  const rows = await query<SanctionRow>("SELECT * FROM sanctions WHERE id = ?", [id]);
  await execute("UPDATE sanctions SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL", [id]);
  if (rows[0]) await invalidateSanctionCaches(rows[0].target_type, rows[0].target_id);
}

/** 대상의 제재 이력 (최신순) */
export async function listSanctions(
  targetType: "user" | "character",
  targetId: number
): Promise<SanctionRow[]> {
  return query<SanctionRow>(
    "SELECT * FROM sanctions WHERE target_type = ? AND target_id = ? ORDER BY id DESC",
    [targetType, targetId]
  );
}

/** 대상의 활성 제재 (kind 별 최대 1개 반환 — 가장 늦게 끝나는 것) */
export async function getActiveSanctions(
  targetType: "user" | "character",
  targetId: number
): Promise<Partial<Record<SanctionKind, SanctionRow>>> {
  const rows = await query<SanctionRow>(
    `SELECT * FROM sanctions
     WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL AND ends_at > NOW()
     ORDER BY ends_at DESC`,
    [targetType, targetId]
  );
  const out: Partial<Record<SanctionKind, SanctionRow>> = {};
  for (const r of rows) if (!out[r.kind]) out[r.kind] = r;
  return out;
}

/** 캐릭터가 hide 제재 중인지 */
export async function isCharacterHidden(characterId: number): Promise<SanctionRow | null> {
  const active = await getActiveSanctions("character", characterId);
  return active.hide ?? null;
}

function fmtUntil(endsAt: string | Date): string {
  const d = new Date(endsAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 유저 제재를 채팅 차단 메시지로. 차단 없으면 null. isNewChat = 이 캐릭터와 첫 대화인지 */
export async function getUserChatBlockMessage(userId: number, isNewChat: boolean): Promise<string | null> {
  const active = await getActiveSanctions("user", userId);
  const block = active.chat_block ?? (isNewChat ? active.new_chat_block : undefined);
  if (!block) return null;
  const what = block.kind === "chat_block" ? "채팅 이용" : "신규 채팅 시작";
  const reason = block.reason ? ` (사유: ${block.reason})` : "";
  return `${what}이 제한된 계정입니다. ${fmtUntil(block.ends_at)} 까지${reason}`;
}

async function invalidateSanctionCaches(targetType: "user" | "character", targetId: number): Promise<void> {
  try {
    if (targetType === "character") {
      await invalidateChatContext(targetId);
      await invalidateCachePattern("cache:web:chars:*");
    }
  } catch {
    // 캐시 실패는 무시
  }
}
