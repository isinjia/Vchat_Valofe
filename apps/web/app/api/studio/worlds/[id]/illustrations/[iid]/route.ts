import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage } from "@vchatbot/core";
import { requireUser, ownedWorld, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; iid: string }> };

/** PUT: 설명 / 지역 사전 항목 변경 */
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, iid } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  const worldId = Number(id);

  const rows = await query("SELECT id FROM world_illustrations WHERE id = ? AND world_id = ?", [Number(iid), worldId]);
  if (rows.length === 0) return bad("찾을 수 없습니다.", 404);

  const body = await req.json().catch(() => ({}));
  let dictEntryId: number | null = null;
  if (body.dict_entry_id != null && body.dict_entry_id !== "") {
    const n = Number(body.dict_entry_id);
    if (!Number.isInteger(n) || n <= 0) return bad("dict_entry_id 가 올바르지 않습니다.");
    const ok = await query(
      "SELECT id FROM world_dictionary WHERE id = ? AND world_id = ? AND category = 'location'",
      [n, worldId]
    );
    if (ok.length === 0) return bad("이 세계관의 지역사전 항목이 아닙니다.");
    dictEntryId = n;
  }
  const description =
    typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

  await execute("UPDATE world_illustrations SET dict_entry_id = ?, description = ? WHERE id = ?", [
    dictEntryId,
    description,
    Number(iid),
  ]);
  return NextResponse.json({ ok: true });
}

/** DELETE: 세계관 일러스트 삭제 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, iid } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;

  const rows = await query<{ storage_key: string }>(
    "SELECT storage_key FROM world_illustrations WHERE id = ? AND world_id = ?",
    [Number(iid), Number(id)]
  );
  if (rows.length === 0) return bad("찾을 수 없습니다.", 404);

  await execute("DELETE FROM world_illustrations WHERE id = ?", [Number(iid)]);
  try {
    const storage = await getStorage();
    await storage.remove(rows[0].storage_key);
  } catch {
    // 스토리지 삭제 실패는 DB 삭제를 막지 않음
  }
  return NextResponse.json({ ok: true });
}
