import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@vchatbot/core";
import { requireUser, bad, canUseWorld } from "@/lib/studio";

export const dynamic = "force-dynamic";

/** GET: 내 캐릭터 목록 (세계관명 포함) */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const rows = await query(
    `SELECT c.id, c.name, c.world_id, c.visibility, c.status, c.title_image_url, w.name AS world_name
     FROM characters c JOIN worlds w ON w.id = c.world_id
     WHERE c.owner_user_id = ? ORDER BY c.id DESC`,
    [auth.userId]
  );
  return NextResponse.json(rows);
}

/** POST: 캐릭터 생성 — world_id 는 내 세계관 또는 open+active 세계관만 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!body.world_id || !name) return bad("world_id, name 은 필수입니다.");
  if (!(await canUseWorld(body.world_id, auth.userId))) {
    return bad("사용할 수 없는 세계관입니다.", 403);
  }
  const result = await execute(
    `INSERT INTO characters (world_id, name, profile, personality, speech_style, ai_prompt, owner_user_id, visibility, status, is_active)
     VALUES (?, ?, '', '', '', '', ?, 'private', 'active', 1)`,
    [Number(body.world_id), name, auth.userId]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
