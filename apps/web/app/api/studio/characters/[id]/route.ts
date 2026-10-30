import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext, scheduleDeletion, cancelDeletion } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad, visibilityOf } from "@/lib/studio";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  // 제작자에게 활성 제재(기간제 비공개)의 사유/기간을 함께 보여준다
  const sanction = await query<{ reason: string | null; ends_at: string }>(
    `SELECT reason, ends_at FROM sanctions
     WHERE target_type = 'character' AND target_id = ? AND kind = 'hide'
       AND revoked_at IS NULL AND ends_at > NOW()
     ORDER BY ends_at DESC LIMIT 1`,
    [Number(id)]
  );
  return NextResponse.json({
    ...own.row,
    sanction_until: sanction[0]?.ends_at ?? null,
    sanction_reason: sanction[0]?.reason ?? null,
  });
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

  // 세계관은 수정에서 바꿀 수 없다 (사전/관계/기념일이 세계관에 묶여 있어 임의 변경 금지)
  const worldId = Number(own.row.world_id);
  if (b.world_id != null && Number(b.world_id) !== worldId) {
    return bad("캐릭터의 세계관은 변경할 수 없습니다.");
  }
  // 세계관 내 캐릭터명 중복 검사 (이름이 바뀐 경우)
  if (name !== own.row.name) {
    const dup = await query("SELECT id FROM characters WHERE world_id = ? AND name = ? AND id <> ? LIMIT 1", [worldId, name, Number(id)]);
    if (dup.length > 0) return bad("이 세계관에 같은 이름의 캐릭터가 이미 있습니다.");
  }
  const s = (v: unknown) => String(v ?? "");
  try {
  await execute(
    `UPDATE characters
     SET name = ?, profile = ?, personality = ?, speech_style = ?, ai_prompt = ?,
         scenario = ?, greeting = ?, visibility = ?
     WHERE id = ? AND owner_user_id = ?`,
    [
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

/**
 * DELETE body:
 *   { name } — 이름 확인 후 3일 삭제 대기 등록 (대기 중 취소 가능)
 *   { cancel: true } — 삭제 대기 취소
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const body = await req.json().catch(() => ({}));
  if (body?.cancel === true) {
    await cancelDeletion("character", Number(id), auth.userId);
    return NextResponse.json({ ok: true, canceled: true });
  }
  try {
    const { scheduledAt } = await scheduleDeletion("character", Number(id), String(body?.name ?? ""), auth.userId);
    return NextResponse.json({ ok: true, scheduledAt });
  } catch (e) {
    return bad((e as Error).message);
  }
}
