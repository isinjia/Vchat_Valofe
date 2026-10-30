import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, invalidateChatContext } from "@vchatbot/core";
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

type Params = { params: Promise<{ id: string; pid: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, pid } = await params;

  const rows = await query<{ storage_key: string | null }>(
    "SELECT storage_key FROM character_profiles WHERE id = ? AND character_id = ?",
    [Number(pid), Number(id)]
  );
  if (rows.length === 0) return bad("찾을 수 없습니다.", 404);
  await execute("DELETE FROM character_profiles WHERE id = ? AND character_id = ?", [Number(pid), Number(id)]);
  if (rows[0].storage_key) {
    try {
      const storage = await getStorage();
      await storage.remove(rows[0].storage_key);
    } catch {
      // 무시
    }
  }
  await invalidateChatContext(Number(id));
  return NextResponse.json({ ok: true });
}
