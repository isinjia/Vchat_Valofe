import { NextRequest, NextResponse } from "next/server";
import { query, execute, parseAnniversaryOverrides, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function worldIdOf(id: string): Promise<number | null> {
  const rows = await query<{ world_id: number }>("SELECT world_id FROM characters WHERE id = ?", [id]);
  return rows.length > 0 ? Number(rows[0].world_id) : null;
}

// 세계관 공유 기념일 + 이 캐릭터의 오버라이드(미적용/설명 덮어쓰기) 목록
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const worldId = await worldIdOf(id);
  if (worldId == null) return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  const [shared, overrides] = await Promise.all([
    query(
      "SELECT id, name, month, day, notice_days, duration_days, description FROM world_anniversaries WHERE world_id = ? AND character_id IS NULL ORDER BY month, day, id",
      [worldId]
    ),
    query("SELECT anniversary_id, mode, description FROM character_anniversary_overrides WHERE character_id = ?", [Number(id)]),
  ]);
  return NextResponse.json({ shared, overrides });
}

// 오버라이드 전체 교체 저장
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const worldId = await worldIdOf(id);
  if (worldId == null) return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  const parsed = parseAnniversaryOverrides(await req.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const characterId = Number(id);

  // 대상이 이 세계관의 공유 기념일인지 검증
  if (parsed.value.length > 0) {
    const ids = parsed.value.map((o) => o.anniversary_id);
    const valid = await query<{ id: number }>(
      `SELECT id FROM world_anniversaries WHERE world_id = ? AND character_id IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
      [worldId, ...ids]
    );
    if (valid.length !== ids.length) {
      return NextResponse.json({ error: "이 세계관의 공유 기념일이 아닌 항목이 있습니다." }, { status: 400 });
    }
  }

  await execute("DELETE FROM character_anniversary_overrides WHERE character_id = ?", [characterId]);
  for (const o of parsed.value) {
    await execute(
      "INSERT INTO character_anniversary_overrides (character_id, anniversary_id, mode, description) VALUES (?, ?, ?, ?)",
      [characterId, o.anniversary_id, o.mode, o.description]
    );
  }
  await invalidateChatContext(characterId);
  return NextResponse.json({ ok: true });
}
