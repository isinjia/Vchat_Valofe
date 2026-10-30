import { NextRequest, NextResponse } from "next/server";
import { query, execute, evaluateTierPromotions, sweepScheduledDeletions } from "@vchatbot/core";
import { requireUser, bad } from "@/lib/studio";

export const dynamic = "force-dynamic";

/** GET: 내 세계관 목록 */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  await sweepScheduledDeletions();
  const rows = await query(
    `SELECT w.id, w.name, w.visibility, w.status, w.title_image_url, w.title_color, w.delete_scheduled_at,
            (SELECT COUNT(*) FROM characters c WHERE c.world_id = w.id) AS character_count
     FROM worlds w WHERE w.owner_user_id = ? ORDER BY w.id DESC`,
    [auth.userId]
  );
  return NextResponse.json(rows);
}

/** POST: 세계관 생성 (기본 비공개) */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return bad("name 은 필수입니다.");
  const result = await execute(
    `INSERT INTO worlds (name, description, ai_prompt, owner_user_id, visibility, status, is_active)
     VALUES (?, ?, ?, ?, 'private', 'active', 1)`,
    [name, String(body.description ?? ""), String(body.ai_prompt ?? ""), auth.userId]
  );
  // 크리에이터 등급 자동 승급 평가 (비동기, 실패 무시)
  void evaluateTierPromotions(auth.userId);
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
