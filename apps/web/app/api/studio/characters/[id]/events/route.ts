import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";
import { parseEventInput, type EventFields } from "@/lib/character-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// 내 캐릭터의 이벤트 목록 (+ 달성 수)
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const rows = await query(
    `SELECT e.*, (SELECT COUNT(*) FROM user_character_events u WHERE u.event_id = e.id AND u.status = 'success') AS success_count
     FROM character_events e WHERE e.character_id = ? ORDER BY e.id`,
    [Number(id)]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const parsed = parseEventInput(await req.json().catch(() => ({})), false);
  if ("error" in parsed) return bad(parsed.error);
  const v = parsed.value as EventFields; // partial=false 이므로 전 필드 존재
  const result = await execute(
    `INSERT INTO character_events (character_id, name, trigger_affinity_min, trigger_keywords, trigger_relationship,
       situation, success_condition, fail_condition, set_relationship, retry_hours, max_turns, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(id), v.name, v.trigger_affinity_min, v.trigger_keywords, v.trigger_relationship, v.situation,
      v.success_condition, v.fail_condition, v.set_relationship, v.retry_hours, v.max_turns, v.is_active,
    ]
  );
  await invalidateChatContext(Number(id));
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
