import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";
import { parseEventInput } from "@/lib/character-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; eid: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function guard(params: Params["params"]): Promise<{ res: NextResponse } | { eid: number; cid: number }> {
  const { id, eid } = await params;
  const rows = await query("SELECT id FROM character_events WHERE id = ? AND character_id = ?", [Number(eid), Number(id)]);
  if (rows.length === 0) return { res: bad("이벤트를 찾을 수 없습니다.", 404) };
  return { eid: Number(eid), cid: Number(id) };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const g = await guard(params);
  if ("res" in g) return g.res;
  const parsed = parseEventInput(await req.json().catch(() => ({})), true);
  if ("error" in parsed) return bad(parsed.error);
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
