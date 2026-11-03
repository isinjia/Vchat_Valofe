import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";
import { parseEventInput } from "@/lib/character-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; eid: string }> };

async function guard(params: Params["params"]): Promise<{ res: NextResponse } | { eid: number; cid: number }> {
  const auth = await requireUser();
  if ("res" in auth) return { res: auth.res };
  const { id, eid } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return { res: own.res };
  const rows = await query("SELECT id FROM character_events WHERE id = ? AND character_id = ?", [Number(eid), Number(id)]);
  if (rows.length === 0) return { res: bad("이벤트를 찾을 수 없습니다.", 404) };
  return { eid: Number(eid), cid: Number(id) };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const g = await guard(params);
  if ("res" in g) return g.res;
  const parsed = parseEventInput(await req.json().catch(() => ({})), true);
  if ("error" in parsed) return bad(parsed.error);
  const sid = parsed.value.success_illustration_id;
  if (sid) {
    const il = await query("SELECT id FROM illustrations WHERE id = ? AND character_id = ?", [sid, g.cid]);
    if (il.length === 0) return bad("달성 시 이미지가 이 캐릭터의 일러스트가 아닙니다.");
  }
  const pid = parsed.value.trigger_prereq_event_id;
  if (pid) {
    if (pid === g.eid) return bad("자기 자신을 선행 이벤트로 지정할 수 없습니다.");
    const pe = await query("SELECT id FROM character_events WHERE id = ? AND character_id = ?", [pid, g.cid]);
    if (pe.length === 0) return bad("선행 이벤트가 이 캐릭터의 이벤트가 아닙니다.");
  }
  const entries = Object.entries(parsed.value);
  if (entries.length === 0) return bad("변경할 필드가 없습니다.");
  await execute(`UPDATE character_events SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [
    ...entries.map(([, val]) => val),
    g.eid,
  ]);
  await invalidateChatContext(g.cid);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const g = await guard(params);
  if ("res" in g) return g.res;
  await execute("DELETE FROM user_character_events WHERE event_id = ?", [g.eid]);
  await execute("DELETE FROM character_events WHERE id = ?", [g.eid]);
  await invalidateChatContext(g.cid);
  return NextResponse.json({ ok: true });
}
