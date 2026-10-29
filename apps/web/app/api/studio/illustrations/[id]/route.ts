import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, invalidateChatContext } from "@vchatbot/core";
import { requireUser, bad } from "@/lib/studio";

type Params = { params: Promise<{ id: string }> };

/** DELETE: 일러스트 삭제 — 소유권은 일러스트가 속한 캐릭터의 owner 로 판단 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const rows = await query<{ storage_key: string; character_id: number; owner_user_id: number | null }>(
    `SELECT i.storage_key, i.character_id, c.owner_user_id
     FROM illustrations i JOIN characters c ON c.id = i.character_id WHERE i.id = ?`,
    [Number(id)]
  );
  if (rows.length === 0) return bad("찾을 수 없습니다.", 404);
  if (rows[0].owner_user_id !== auth.userId) return bad("권한이 없습니다.", 403);

  await execute("DELETE FROM illustrations WHERE id = ?", [Number(id)]);
  try {
    const storage = await getStorage();
    await storage.remove(rows[0].storage_key);
  } catch {
    // 스토리지 삭제 실패는 DB 삭제를 막지 않음
  }
  await invalidateChatContext(rows[0].character_id);
  return NextResponse.json({ ok: true });
}
