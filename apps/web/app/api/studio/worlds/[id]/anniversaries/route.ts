import { NextRequest, NextResponse } from "next/server";
import { query, execute, parseAnniversaryInput, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedWorld, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  const rows = await query(
    `SELECT a.*, p.name AS preset_name
     FROM world_anniversaries a LEFT JOIN anniversary_presets p ON p.id = a.preset_id
     WHERE a.world_id = ? AND a.character_id IS NULL ORDER BY a.month, a.day, a.id`,
    [Number(id)]
  );
  return NextResponse.json(rows);
}

/** body 가 {preset_id} 면 프리셋 값 복사(스냅샷) 생성, {name, month, day, description} 이면 커스텀 생성 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  const worldId = Number(id);
  const body = await req.json().catch(() => ({}));

  if (body.preset_id != null) {
    const presetId = Number(body.preset_id);
    const presets = await query<{ name: string; month: number; day: number; notice_days: number; description: string }>(
      "SELECT * FROM anniversary_presets WHERE id = ?",
      [presetId]
    );
    if (presets.length === 0) return bad("프리셋을 찾을 수 없습니다.", 404);
    const dup = await query("SELECT id FROM world_anniversaries WHERE world_id = ? AND preset_id = ?", [worldId, presetId]);
    if (dup.length > 0) return bad("이미 불러온 프리셋입니다.", 409);
    const p = presets[0];
    const result = await execute(
      "INSERT INTO world_anniversaries (world_id, preset_id, name, month, day, notice_days, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [worldId, presetId, p.name, p.month, p.day, p.notice_days, p.description]
    );
    await invalidateChatContext();
    return NextResponse.json({ id: result.insertId }, { status: 201 });
  }

  const parsed = parseAnniversaryInput(body);
  if ("error" in parsed) return bad(parsed.error);
  const { name, month, day, notice_days, description } = parsed.value;
  const result = await execute(
    "INSERT INTO world_anniversaries (world_id, preset_id, name, month, day, notice_days, description) VALUES (?, NULL, ?, ?, ?, ?, ?)",
    [worldId, name, month, day, notice_days, description]
  );
  await invalidateChatContext();
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
