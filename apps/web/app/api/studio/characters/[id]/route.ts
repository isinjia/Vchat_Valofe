import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad, canUseWorld, visibilityOf } from "@/lib/studio";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  return NextResponse.json(own.row);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const b = await req.json().catch(() => ({}));
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return bad("name 은 필수입니다.");

  // 세계관이 바뀌는 경우에만 사용 가능 여부 검증 (기존 세계관이 비공개로 바뀐 경우 유지는 허용)
  const worldId = Number(b.world_id);
  if (worldId !== Number(own.row.world_id) && !(await canUseWorld(worldId, auth.userId))) {
    return bad("사용할 수 없는 세계관입니다.", 403);
  }
  // 세계관 내 캐릭터명 중복 검사 (이름/세계관이 바뀐 경우)
  if (name !== own.row.name || worldId !== Number(own.row.world_id)) {
    const dup = await query("SELECT id FROM characters WHERE world_id = ? AND name = ? AND id <> ? LIMIT 1", [worldId, name, Number(id)]);
    if (dup.length > 0) return bad("이 세계관에 같은 이름의 캐릭터가 이미 있습니다.");
  }
  const s = (v: unknown) => String(v ?? "");
  try {
  await execute(
    `UPDATE characters
     SET world_id = ?, name = ?, profile = ?, personality = ?, speech_style = ?, ai_prompt = ?,
         scenario = ?, greeting = ?, visibility = ?
     WHERE id = ? AND owner_user_id = ?`,
    [
      worldId,
      name,
      s(b.profile),
      s(b.personality),
      s(b.speech_style),
      s(b.ai_prompt),
      s(b.scenario).trim() ? s(b.scenario) : null,
      s(b.greeting).trim() ? s(b.greeting) : null,
      visibilityOf(b.visibility),
      Number(id),
      auth.userId,
    ]
  );
  } catch (e) {
    // UNIQUE 제약 위반 (동시 요청 레이스 대비)
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return bad("이 세계관에 같은 이름의 캐릭터가 이미 있습니다.");
    throw e;
  }
  await invalidateChatContext(Number(id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  await execute("DELETE FROM characters WHERE id = ? AND owner_user_id = ?", [Number(id), auth.userId]);
  await invalidateChatContext(Number(id));
  return NextResponse.json({ ok: true });
}
