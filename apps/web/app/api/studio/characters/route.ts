import { NextRequest, NextResponse } from "next/server";
import { query, execute, evaluateTierPromotions, sweepScheduledDeletions } from "@vchatbot/core";
import { requireUser, bad, canUseWorld, checkWorldNameScope } from "@/lib/studio";
import { isAdultUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/** GET: 내 캐릭터 목록 (세계관명 포함) */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  await sweepScheduledDeletions();
  const rows = await query(
    `SELECT c.id, c.name, c.world_id, c.visibility, c.status, c.title_image_url, c.delete_scheduled_at, w.name AS world_name,
            (SELECT s.ends_at FROM sanctions s
             WHERE s.target_type = 'character' AND s.target_id = c.id AND s.kind = 'hide'
               AND s.revoked_at IS NULL AND s.ends_at > NOW()
             ORDER BY s.ends_at DESC LIMIT 1) AS sanction_until,
            (SELECT s.reason FROM sanctions s
             WHERE s.target_type = 'character' AND s.target_id = c.id AND s.kind = 'hide'
               AND s.revoked_at IS NULL AND s.ends_at > NOW()
             ORDER BY s.ends_at DESC LIMIT 1) AS sanction_reason
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
  // 19금 세계관은 성인 인증된 유저만 캐릭터 생성 가능 (미성년·미확인 차단)
  const wAdult = await query<{ is_adult: number }>("SELECT is_adult FROM worlds WHERE id = ?", [Number(body.world_id)]);
  if (Number(wAdult[0]?.is_adult ?? 0) === 1 && !(await isAdultUser(auth.userId))) {
    return bad("19금 세계관은 성인 인증된 계정만 사용할 수 있습니다.", 403);
  }
  const scopeErr = await checkWorldNameScope(body.world_id, auth.userId, name);
  if (scopeErr) return bad(scopeErr);
  // 세계관 내 캐릭터명 중복 검사
  const dup = await query("SELECT id FROM characters WHERE world_id = ? AND name = ? LIMIT 1", [Number(body.world_id), name]);
  if (dup.length > 0) return bad("이 세계관에 같은 이름의 캐릭터가 이미 있습니다.");
  try {
    const result = await execute(
      `INSERT INTO characters (world_id, name, profile, personality, speech_style, ai_prompt, owner_user_id, visibility, status, is_active)
       VALUES (?, ?, '', '', '', '', ?, 'private', 'active', 1)`,
      [Number(body.world_id), name, auth.userId]
    );
    // 크리에이터 등급 자동 승급 평가 (비동기, 실패 무시)
    void evaluateTierPromotions(auth.userId);
    return NextResponse.json({ id: result.insertId }, { status: 201 });
  } catch (e) {
    // UNIQUE 제약 위반 (동시 요청 레이스 대비)
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return bad("이 세계관에 같은 이름의 캐릭터가 이미 있습니다.");
    throw e;
  }
}
