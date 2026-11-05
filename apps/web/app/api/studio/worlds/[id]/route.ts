import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext, scheduleDeletion, cancelDeletion } from "@vchatbot/core";
import { requireUser, ownedWorld, bad, visibilityOf } from "@/lib/studio";
import { isAdultUser } from "@/lib/user";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  return NextResponse.json({
    ...own.row,
    // 제작자 본인의 성인 인증 여부 — 0 이면 19금 체크 UI 잠금
    viewer_is_adult: (await isAdultUser(auth.userId)) ? 1 : 0,
  });
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
  const dup = await query("SELECT id FROM worlds WHERE name = ? AND id <> ? LIMIT 1", [name, Number(id)]);
  if (dup.length > 0) return bad("이미 존재하는 세계관 이름입니다.", 409);
  // 19금 설정은 성인 인증된 제작자만 (미성년·미확인 계정 차단)
  const wantAdult = body.is_adult === true || body.is_adult === 1;
  if (wantAdult && Number(own.row.is_adult) !== 1 && !(await isAdultUser(auth.userId))) {
    return bad("19금 설정은 성인 인증된 계정만 할 수 있습니다.", 403);
  }
  // 타이틀 컬러: #rrggbb 형식만 허용, 그 외/빈 값은 NULL
  const titleColor =
    typeof body.title_color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.title_color.trim())
      ? body.title_color.trim().toLowerCase()
      : null;
  await execute(
    "UPDATE worlds SET name = ?, description = ?, ai_prompt = ?, visibility = ?, open_scope = ?, title_color = ?, is_adult = ? WHERE id = ? AND owner_user_id = ?",
    [name, String(body.description ?? ""), String(body.ai_prompt ?? ""), visibilityOf(body.visibility), body.open_scope === "dict_person" ? "dict_person" : "all", titleColor, body.is_adult === true || body.is_adult === 1 ? 1 : 0, Number(id), auth.userId]
  );
  await invalidateChatContext();
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
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  const body = await req.json().catch(() => ({}));
  if (body?.cancel === true) {
    await cancelDeletion("world", Number(id), auth.userId);
    return NextResponse.json({ ok: true, canceled: true });
  }
  // 다른 유저가 이 세계관으로 만든 캐릭터가 있으면 연쇄 삭제되므로 막는다
  const others = await query(
    "SELECT id FROM characters WHERE world_id = ? AND (owner_user_id IS NULL OR owner_user_id <> ?) LIMIT 1",
    [Number(id), auth.userId]
  );
  if (others.length > 0) {
    return bad("다른 유저가 이 세계관으로 만든 캐릭터가 있어 삭제할 수 없습니다. 비공개로 전환하세요.", 409);
  }
  try {
    const { scheduledAt } = await scheduleDeletion("world", Number(id), String(body?.name ?? ""), auth.userId);
    return NextResponse.json({ ok: true, scheduledAt });
  } catch (e) {
    return bad((e as Error).message);
  }
}
