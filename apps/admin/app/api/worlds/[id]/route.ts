import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext, scheduleDeletion, cancelDeletion } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query(
    `SELECT w.*, u.nickname AS owner_nickname, u.vfun_user_id AS owner_vfun_id, u.vfun_u_no AS owner_u_no
     FROM worlds w LEFT JOIN users u ON u.id = w.owner_user_id WHERE w.id = ?`,
    [id]
  );
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { name, description, ai_prompt, is_active, is_adult, visibility, status, title_color, open_scope } = await req.json();
  // 타이틀 컬러: #rrggbb 형식만 허용, 그 외/빈 값은 NULL
  const titleColor =
    typeof title_color === "string" && /^#[0-9a-fA-F]{6}$/.test(title_color.trim())
      ? title_color.trim().toLowerCase()
      : null;
  await execute(
    `UPDATE worlds SET name = ?, description = ?, ai_prompt = ?, is_active = ?, is_adult = ?, visibility = ?, open_scope = ?, status = ?, title_color = ? WHERE id = ?`,
    [
      name,
      description,
      ai_prompt,
      is_active ? 1 : 0,
      is_adult ? 1 : 0,
      visibility === "open" ? "open" : "private",
      open_scope === "dict_person" ? "dict_person" : "all",
      status === "suspended" ? "suspended" : "active",
      titleColor,
      id,
    ]
  );
  await invalidateChatContext();
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
    await cancelDeletion("world", Number(id));
    return NextResponse.json({ ok: true, canceled: true });
  }
  try {
    const { scheduledAt } = await scheduleDeletion("world", Number(id), String(body?.name ?? ""));
    return NextResponse.json({ ok: true, scheduledAt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
