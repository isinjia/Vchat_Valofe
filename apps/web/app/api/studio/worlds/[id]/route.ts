import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedWorld, bad, visibilityOf } from "@/lib/studio";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  return NextResponse.json(own.row);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return bad("name 은 필수입니다.");
  await execute(
    "UPDATE worlds SET name = ?, description = ?, ai_prompt = ?, visibility = ? WHERE id = ? AND owner_user_id = ?",
    [name, String(body.description ?? ""), String(body.ai_prompt ?? ""), visibilityOf(body.visibility), Number(id), auth.userId]
  );
  await invalidateChatContext();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  // 다른 유저가 이 세계관으로 만든 캐릭터가 있으면 연쇄 삭제되므로 막는다
  const others = await query(
    "SELECT id FROM characters WHERE world_id = ? AND (owner_user_id IS NULL OR owner_user_id <> ?) LIMIT 1",
    [Number(id), auth.userId]
  );
  if (others.length > 0) {
    return bad("다른 유저가 이 세계관으로 만든 캐릭터가 있어 삭제할 수 없습니다. 비공개로 전환하세요.", 409);
  }
  await execute("DELETE FROM worlds WHERE id = ? AND owner_user_id = ?", [Number(id), auth.userId]);
  await invalidateChatContext();
  return NextResponse.json({ ok: true });
}
