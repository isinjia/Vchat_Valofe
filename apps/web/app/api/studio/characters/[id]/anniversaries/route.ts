import { NextRequest, NextResponse } from "next/server";
import { query, execute, parseAnniversaryInput, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// 내 캐릭터의 개인 기념일 목록
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const rows = await query(
    "SELECT * FROM world_anniversaries WHERE character_id = ? ORDER BY month, day, id",
    [Number(id)]
  );
  return NextResponse.json(rows);
}

// 개인 기념일 생성 (world_id 는 캐릭터의 세계관, preset_id 는 항상 NULL)
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const parsed = parseAnniversaryInput(await req.json().catch(() => ({})));
  if ("error" in parsed) return bad(parsed.error);
  const { name, month, day, description } = parsed.value;
  const characterId = Number(id);
  const result = await execute(
    "INSERT INTO world_anniversaries (world_id, character_id, preset_id, name, month, day, description) VALUES (?, ?, NULL, ?, ?, ?, ?)",
    [Number(own.row.world_id), characterId, name, month, day, description]
  );
  await invalidateChatContext(characterId);
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
