import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@vchatbot/core";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function parseId(params: Params["params"]): Promise<number | null> {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** PUT { role } — 관리자 등급 변경 */
export async function PUT(req: NextRequest, { params }: Params) {
  const id = await parseId(params);
  if (!id) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const role = b.role;
  if (role !== "user_admin" && role !== "system_admin") {
    return NextResponse.json({ error: "role 은 user_admin/system_admin 만 가능합니다." }, { status: 400 });
  }
  const session = await getAdminSession();
  if (session && session.uid === id && role === "user_admin") {
    return NextResponse.json({ error: "자기 자신의 권한은 낮출 수 없습니다." }, { status: 400 });
  }
  const ex = await query("SELECT id FROM users WHERE id = ? AND admin_role IS NOT NULL", [id]);
  if (!ex.length) return NextResponse.json({ error: "관리자가 아닙니다." }, { status: 404 });
  await execute("UPDATE users SET admin_role = ? WHERE id = ?", [role, id]);
  return NextResponse.json({ ok: true });
}

/** DELETE — 관리자에서 제외 (admin_role = NULL) */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = await parseId(params);
  if (!id) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  const session = await getAdminSession();
  if (session && session.uid === id) {
    return NextResponse.json({ error: "자기 자신을 관리자에서 제외할 수 없습니다." }, { status: 400 });
  }
  await execute("UPDATE users SET admin_role = NULL WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
