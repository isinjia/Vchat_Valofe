import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";
import { parseProfileSetInput, PROFILE_SET_CATEGORIES } from "@/lib/profile-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** GET: 프로필 세트 목록(조건 + 이미지 + 얼굴세트 감정별 항목) + 조건 선택용 기념일 목록 { sets, anniversaries } */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const cid = Number(id);

  const sets = await query<{ id: number }>(
    `SELECT s.id, s.category, s.name, s.season, s.anniversary_id, a.name AS anniversary_name,
            s.days_before, s.days_after, s.min_affinity, s.emotion, s.bg_rule,
            s.url, s.effect_scale, s.effect_x, s.effect_y, s.sort_order
     FROM character_profile_sets s
     LEFT JOIN world_anniversaries a ON a.id = s.anniversary_id
     WHERE s.character_id = ?
     ORDER BY s.sort_order, s.id`,
    [cid]
  );
  const items = sets.length
    ? await query<{ set_id: number }>(
        `SELECT id, set_id, emotion, url FROM character_profile_items
         WHERE set_id IN (${sets.map(() => "?").join(",")}) ORDER BY id`,
        sets.map((s) => s.id)
      )
    : [];
  const bySet = new Map<number, unknown[]>();
  for (const it of items) {
    const list = bySet.get(it.set_id) ?? [];
    list.push(it);
    bySet.set(it.set_id, list);
  }
  // 조건 선택용 기념일: 세계관 공통 + 이 캐릭터 개인
  const anniversaries = await query(
    `SELECT id, name, month, day, duration_days, character_id
     FROM world_anniversaries
     WHERE world_id = ? AND (character_id IS NULL OR character_id = ?)
     ORDER BY month, day, id`,
    [Number(own.row.world_id), cid]
  );
  return NextResponse.json({
    enabled: !!own.row.advanced_profile,
    sets: sets.map((s) => ({ ...s, items: bySet.get(s.id) ?? [] })),
    anniversaries,
  });
}

/** POST: 세트 생성 { category, name, season?, anniversaryId?, daysBefore?, daysAfter?, minAffinity?, emotion? } */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const cid = Number(id);

  const body = await req.json().catch(() => ({}));
  const category = String(body.category ?? "");
  if (!PROFILE_SET_CATEGORIES.includes(category as (typeof PROFILE_SET_CATEGORIES)[number])) {
    return bad("category 는 background/face/effect 중 하나여야 합니다.");
  }
  const parsed = await parseProfileSetInput(body, category, Number(own.row.world_id), cid);
  if ("error" in parsed) return bad(parsed.error);
  const v = parsed.value;

  const result = await execute(
    `INSERT INTO character_profile_sets
       (character_id, category, name, season, anniversary_id, days_before, days_after, min_affinity, emotion, bg_rule)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [cid, category, v.name, v.season, v.anniversary_id, v.days_before, v.days_after, v.min_affinity, v.emotion, v.bg_rule]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}

/** PATCH: 고급 프로필 사용 on/off { enabled } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const body = await req.json().catch(() => ({}));
  await execute("UPDATE characters SET advanced_profile = ? WHERE id = ?", [body.enabled ? 1 : 0, Number(id)]);
  return NextResponse.json({ ok: true, enabled: !!body.enabled });
}
