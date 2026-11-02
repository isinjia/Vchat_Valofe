import { NextRequest, NextResponse } from "next/server";
import { query, execute, type WorldItemRow } from "@vchatbot/core";
import { parseWorldItemInput } from "@/lib/world-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}
async function worldExists(id: string): Promise<boolean> {
  const rows = await query("SELECT id FROM worlds WHERE id = ?", [Number(id)]);
  return rows.length > 0;
}

/**
 * GET: 선물 아이템 목록 (페이징 + 필터)
 *   ?page=1&limit=20&effect=affinity|reset&characterId=<보너스 대상 캐릭터>
 * 응답: { items(보너스 포함), total, page, limit, characters(셀렉트용 세계관 캐릭터) }
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!(await worldExists(id))) return bad("세계관을 찾을 수 없습니다.", 404);
  const worldId = Number(id);

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(50, Math.max(1, Number(sp.get("limit")) || 20));
  const effect = sp.get("effect"); // affinity | reset
  const charFilter = Number(sp.get("characterId")) || 0;

  const where: string[] = ["i.world_id = ?"];
  const args: (number | string)[] = [worldId];
  if (effect === "reset") where.push("i.reset_affinity = 1");
  if (effect === "affinity") where.push("i.reset_affinity = 0");
  if (charFilter > 0) {
    where.push("EXISTS (SELECT 1 FROM world_item_characters c WHERE c.item_id = i.id AND c.character_id = ?)");
    args.push(charFilter);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [totalRows, items, characters] = await Promise.all([
    query<{ c: number }>(`SELECT COUNT(*) AS c FROM world_items i ${whereSql}`, args),
    query<WorldItemRow>(
      `SELECT i.* FROM world_items i ${whereSql} ORDER BY i.sort_order, i.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      args
    ),
    query<{ id: number; name: string }>(
      "SELECT id, name FROM characters WHERE world_id = ? ORDER BY id",
      [worldId]
    ),
  ]);

  const ids = items.map((i) => i.id);
  const bonuses = ids.length
    ? await query<{ item_id: number; character_id: number; bonus_affinity: number; character_name: string }>(
        `SELECT b.item_id, b.character_id, b.bonus_affinity, c.name AS character_name
         FROM world_item_characters b JOIN characters c ON c.id = b.character_id
         WHERE b.item_id IN (${ids.map(() => "?").join(",")})`,
        ids
      )
    : [];
  const byItem = new Map<number, typeof bonuses>();
  for (const b of bonuses) {
    const list = byItem.get(b.item_id) ?? [];
    list.push(b);
    byItem.set(b.item_id, list);
  }

  return NextResponse.json({
    items: items.map((i) => ({ ...i, bonuses: byItem.get(i.id) ?? [] })),
    total: Number(totalRows[0]?.c ?? 0),
    page,
    limit,
    characters,
  });
}

/** POST: 아이템 생성 (JSON — 이미지는 생성 후 업로드 라우트로) */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!(await worldExists(id))) return bad("세계관을 찾을 수 없습니다.", 404);
  const worldId = Number(id);

  const body = await req.json().catch(() => ({}));
  const parsed = await parseWorldItemInput(body, worldId);
  if ("error" in parsed) return bad(parsed.error);
  const v = parsed.value;

  const result = await execute(
    `INSERT INTO world_items
       (world_id, name, description, price, affinity_delta, reset_affinity, cooldown_hours,
        max_uses_per_character, char_rule, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      worldId, v.name, v.description, v.price, v.affinity_delta, v.reset_affinity,
      v.cooldown_hours, v.max_uses_per_character, v.char_rule, v.sort_order, v.is_active,
    ]
  );
  for (const b of v.bonuses) {
    await execute(
      "INSERT INTO world_item_characters (item_id, character_id, bonus_affinity) VALUES (?, ?, ?)",
      [result.insertId, b.characterId, b.bonus]
    );
  }
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
