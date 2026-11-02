import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, type WorldItemRow } from "@vchatbot/core";
import { parseWorldItemInput } from "@/lib/world-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; iid: string }> };

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}
async function worldExists(id: string): Promise<boolean> {
  const rows = await query("SELECT id FROM worlds WHERE id = ?", [Number(id)]);
  return rows.length > 0;
}

async function ownedItem(worldId: number, iid: string): Promise<WorldItemRow | null> {
  const rows = await query<WorldItemRow>("SELECT * FROM world_items WHERE id = ? AND world_id = ?", [
    Number(iid),
    worldId,
  ]);
  return rows[0] ?? null;
}

/** PUT: 아이템 수정 (보너스 목록은 전체 교체) */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, iid } = await params;
  if (!(await worldExists(id))) return bad("세계관을 찾을 수 없습니다.", 404);
  const worldId = Number(id);
  const item = await ownedItem(worldId, iid);
  if (!item) return bad("아이템을 찾을 수 없습니다.", 404);

  const body = await req.json().catch(() => ({}));
  const parsed = await parseWorldItemInput(body, worldId);
  if ("error" in parsed) return bad(parsed.error);
  const v = parsed.value;

  await execute(
    `UPDATE world_items
     SET name = ?, description = ?, price = ?, affinity_delta = ?, reset_affinity = ?,
         cooldown_hours = ?, max_uses_per_character = ?, char_rule = ?, sort_order = ?, is_active = ?
     WHERE id = ?`,
    [
      v.name, v.description, v.price, v.affinity_delta, v.reset_affinity,
      v.cooldown_hours, v.max_uses_per_character, v.char_rule, v.sort_order, v.is_active, item.id,
    ]
  );
  await execute("DELETE FROM world_item_characters WHERE item_id = ?", [item.id]);
  for (const b of v.bonuses) {
    await execute(
      "INSERT INTO world_item_characters (item_id, character_id, bonus_affinity) VALUES (?, ?, ?)",
      [item.id, b.characterId, b.bonus]
    );
  }
  return NextResponse.json({ ok: true });
}

/** DELETE: 아이템 삭제 (아이콘/이미지 스토리지 포함, 사용 기록은 item_id=NULL 로 보존) */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, iid } = await params;
  if (!(await worldExists(id))) return bad("세계관을 찾을 수 없습니다.", 404);
  const item = await ownedItem(Number(id), iid);
  if (!item) return bad("아이템을 찾을 수 없습니다.", 404);

  await execute("DELETE FROM world_items WHERE id = ?", [item.id]);
  try {
    const storage = await getStorage();
    for (const k of [item.icon_key, item.image_key]) {
      if (!k) continue;
      try {
        await storage.remove(k);
      } catch {
        // 무시
      }
    }
  } catch {
    // 스토리지 미설정 — DB 삭제는 완료
  }
  return NextResponse.json({ ok: true });
}
