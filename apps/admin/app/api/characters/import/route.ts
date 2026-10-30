import { NextRequest, NextResponse } from "next/server";
import { query, importCharacter } from "@vchatbot/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 캐릭터 JSON 가져오기: body { worldId, data } → 대상 세계관에 새 캐릭터 생성 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const worldId = Number(body?.worldId);
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return NextResponse.json({ error: "worldId 가 올바르지 않습니다." }, { status: 400 });
  }
  const w = await query("SELECT id FROM worlds WHERE id = ?", [worldId]);
  if (w.length === 0) return NextResponse.json({ error: "세계관을 찾을 수 없습니다." }, { status: 404 });
  try {
    return NextResponse.json(await importCharacter(body?.data, worldId, null), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
