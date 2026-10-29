import { NextRequest, NextResponse } from "next/server";
import { query, execute, parseAnniversaryInput, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; aid: string }> };

/** 내 캐릭터 소유 + 해당 캐릭터의 개인 기념일인지 검사 */
async function guard(params: Params["params"]): Promise<{ res: NextResponse } | { aid: number; cid: number }> {
  const auth = await requireUser();
  if ("res" in auth) return { res: auth.res };
  const { id, aid } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return { res: own.res };
  const rows = await query("SELECT id FROM world_anniversaries WHERE id = ? AND character_id = ?", [Number(aid), Number(id)]);
  if (rows.length === 0) return { res: bad("기념일을 찾을 수 없습니다.", 404) };
  return { aid: Number(aid), cid: Number(id) };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const g = await guard(params);
  if ("res" in g) return g.res;
  const parsed = parseAnniversaryInput(await req.json().catch(() => ({})));
  if ("error" in parsed) return bad(parsed.error);
  const { name, month, day, description } = parsed.value;
  await execute(
    "UPDATE world_anniversaries SET name = ?, month = ?, day = ?, description = ? WHERE id = ?",
    [name, month, day, description, g.aid]
  );
  await invalidateChatContext(g.cid);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const g = await guard(params);
  if ("res" in g) return g.res;
  await execute("DELETE FROM world_anniversaries WHERE id = ?", [g.aid]);
  await invalidateChatContext(g.cid);
  return NextResponse.json({ ok: true });
}
