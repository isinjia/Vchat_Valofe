import { NextRequest, NextResponse } from "next/server";
import {
  query,
  execute,
  invalidateChatContext,
  scheduleDeletion,
  cancelDeletion,
  compactPersonaStatus,
  type CharacterPersona,
} from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query(
    `SELECT c.*, u.nickname AS owner_nickname, u.vfun_user_id AS owner_vfun_id, u.vfun_u_no AS owner_u_no
     FROM characters c LEFT JOIN users u ON u.id = c.owner_user_id WHERE c.id = ?`,
    [id]
  );
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    ...rows[0],
    // 브라우저 AI 프로필 상태: ready | stale(재생성 필요) | missing
    compact_status: compactPersonaStatus(rows[0] as unknown as CharacterPersona),
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { name, profile, personality, speech_style, ai_prompt, scenario, greeting, is_active, visibility, status, title_color, browser_llm_enabled } =
    await req.json();
  // 타이틀 컬러: #rrggbb 또는 null (null = 세계관 색 따름)
  const titleColor = typeof title_color === "string" && /^#[0-9a-fA-F]{6}$/.test(title_color) ? title_color : null;
  // 세계관은 수정에서 바꿀 수 없다 (사전/관계/기념일이 세계관에 묶여 있음) — 현재 세계관 기준으로 중복 검사
  const cur = await query<{ world_id: number }>("SELECT world_id FROM characters WHERE id = ?", [id]);
  if (cur.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const dup = await query("SELECT id FROM characters WHERE world_id = ? AND name = ? AND id <> ? LIMIT 1", [cur[0].world_id, name, Number(id)]);
  if (dup.length > 0) return NextResponse.json({ error: "이 세계관에 같은 이름의 캐릭터가 이미 있습니다." }, { status: 400 });
  try {
  await execute(
    `UPDATE characters
     SET name = ?, profile = ?, personality = ?, speech_style = ?, ai_prompt = ?, scenario = ?, greeting = ?, is_active = ?,
         visibility = ?, status = ?, title_color = ?, browser_llm_enabled = ?
     WHERE id = ?`,
    [
      name,
      profile,
      personality,
      speech_style,
      ai_prompt,
      scenario?.trim() ? scenario : null,
      greeting?.trim() ? greeting : null,
      is_active ? 1 : 0,
      visibility === "open" ? "open" : "private",
      status === "suspended" ? "suspended" : "active",
      titleColor,
      browser_llm_enabled ? 1 : 0,
      id,
    ]
  );
  } catch (e) {
    // UNIQUE 제약 위반 (동시 요청 레이스 대비)
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "이 세계관에 같은 이름의 캐릭터가 이미 있습니다." }, { status: 400 });
    throw e;
  }
  await invalidateChatContext(Number(id));
  return NextResponse.json({ ok: true });
}

/**
 * DELETE body:
 *   { name } — 이름 확인 후 3일 삭제 대기 등록
 *   { cancel: true } — 삭제 대기 취소
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body?.cancel === true) {
    await cancelDeletion("character", Number(id));
    return NextResponse.json({ ok: true, canceled: true });
  }
  try {
    const { scheduledAt } = await scheduleDeletion("character", Number(id), String(body?.name ?? ""));
    return NextResponse.json({ ok: true, scheduledAt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
