import { NextRequest, NextResponse } from "next/server";
import { query, execute, parseAnniversaryInput, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 프리셋명은 UI 의 출처 뱃지용
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query(
    `SELECT a.*, p.name AS preset_name
     FROM world_anniversaries a LEFT JOIN anniversary_presets p ON p.id = a.preset_id
     WHERE a.world_id = ? AND a.character_id IS NULL ORDER BY a.month, a.day, a.id`,
    [id]
  );
  return NextResponse.json(rows);
}

/** body 가 {preset_id} 면 프리셋 값을 복사(스냅샷), 아니면 커스텀 생성 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const worlds = await query("SELECT id FROM worlds WHERE id = ?", [id]);
  if (worlds.length === 0) return NextResponse.json({ error: "세계관을 찾을 수 없습니다." }, { status: 404 });

  if (body.preset_id != null) {
    const presetId = Number(body.preset_id);
    const presets = await query<{ name: string; month: number; day: number; description: string }>(
      "SELECT * FROM anniversary_presets WHERE id = ?",
      [presetId]
    );
    if (presets.length === 0) return NextResponse.json({ error: "프리셋을 찾을 수 없습니다." }, { status: 404 });
    const dup = await query("SELECT id FROM world_anniversaries WHERE world_id = ? AND preset_id = ?", [id, presetId]);
    if (dup.length > 0) return NextResponse.json({ error: "이미 불러온 프리셋입니다." }, { status: 409 });
    const p = presets[0];
    const result = await execute(
      "INSERT INTO world_anniversaries (world_id, preset_id, name, month, day, description) VALUES (?, ?, ?, ?, ?, ?)",
      [id, presetId, p.name, p.month, p.day, p.description]
    );
    await invalidateChatContext();
    return NextResponse.json({ id: result.insertId }, { status: 201 });
  }

  const parsed = parseAnniversaryInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { name, month, day, description } = parsed.value;
  const result = await execute(
    "INSERT INTO world_anniversaries (world_id, preset_id, name, month, day, description) VALUES (?, NULL, ?, ?, ?, ?)",
    [id, name, month, day, description]
  );
  await invalidateChatContext();
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
