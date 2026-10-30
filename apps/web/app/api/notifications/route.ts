import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

/** GET: 안 읽은 알림 (최신순 최대 10개) */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const items = await query<{ id: number; type: string; title: string; body: string | null; created_at: string }>(
    `SELECT id, type, title, body, created_at FROM user_notifications
     WHERE user_id = ? AND read_at IS NULL ORDER BY id DESC LIMIT 10`,
    [userId]
  );
  return NextResponse.json({ items });
}

/** PUT { ids: number[] } — 읽음 처리 */
export async function PUT(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
  if (ids.length === 0) return NextResponse.json({ ok: true });
  await execute(
    `UPDATE user_notifications SET read_at = NOW() WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    [userId, ...ids]
  );
  return NextResponse.json({ ok: true });
}
