import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage } from "@vchatbot/core";
import { parseProfileSetInput } from "@/lib/profile-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sid: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** 캐릭터 존재 확인 (관리툴: 소유권 검사 없음) */
async function existingCharacter(id: string): Promise<{ world_id: number; advanced_profile: number } | { res: NextResponse }> {
  const rows = await query<{ world_id: number; advanced_profile: number }>(
    "SELECT id, world_id, advanced_profile FROM characters WHERE id = ?",
    [Number(id)]
  );
  if (rows.length === 0) return { res: bad("찾을 수 없습니다.", 404) };
  return rows[0];
}

interface SetRow {
  id: number;
  category: "background" | "face" | "effect";
  storage_key: string | null;
}

/** 세트가 이 캐릭터 소속인지 확인 */
async function ownedSet(cid: number, sid: string): Promise<SetRow | null> {
  const rows = await query<SetRow>(
    "SELECT id, category, storage_key FROM character_profile_sets WHERE id = ? AND character_id = ?",
    [Number(sid), cid]
  );
  return rows[0] ?? null;
}

/** PUT: 이름/조건 수정 (+ effect 세트는 배치값 effectScale/effectX/effectY) */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, sid } = await params;
  const own = await existingCharacter(id);
  if ("res" in own) return own.res;
  const cid = Number(id);
  const set = await ownedSet(cid, sid);
  if (!set) return bad("세트를 찾을 수 없습니다.", 404);

  const body = await req.json().catch(() => ({}));
  const parsed = await parseProfileSetInput(body, set.category, Number(own.world_id), cid);
  if ("error" in parsed) return bad(parsed.error);
  const v = parsed.value;

  // effect 배치값 (미전달 시 유지)
  let transformSql = "";
  const transformArgs: number[] = [];
  if (set.category === "effect" && (body.effectScale !== undefined || body.effectX !== undefined || body.effectY !== undefined)) {
    const num = (x: unknown, min: number, max: number) => {
      const n = Number(x);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
    };
    const scale = num(body.effectScale, 0.2, 8);
    const ex = num(body.effectX, -4, 4);
    const ey = num(body.effectY, -4, 4);
    if (scale == null || ex == null || ey == null) return bad("효과 배치값이 올바르지 않습니다.");
    transformSql = ", effect_scale = ?, effect_x = ?, effect_y = ?";
    transformArgs.push(scale, ex, ey);
  }

  await execute(
    `UPDATE character_profile_sets
     SET name = ?, season = ?, anniversary_id = ?, days_before = ?, days_after = ?, min_affinity = ?, emotion = ?, bg_rule = ?${transformSql}
     WHERE id = ?`,
    [v.name, v.season, v.anniversary_id, v.days_before, v.days_after, v.min_affinity, v.emotion, v.bg_rule, ...transformArgs, set.id]
  );
  return NextResponse.json({ ok: true });
}

/** DELETE: 세트 삭제 (이미지/항목 스토리지 파일 포함) */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, sid } = await params;
  const own = await existingCharacter(id);
  if ("res" in own) return own.res;
  const set = await ownedSet(Number(id), sid);
  if (!set) return bad("세트를 찾을 수 없습니다.", 404);

  const items = await query<{ storage_key: string }>(
    "SELECT storage_key FROM character_profile_items WHERE set_id = ?",
    [set.id]
  );
  await execute("DELETE FROM character_profile_sets WHERE id = ?", [set.id]); // items 는 FK CASCADE

  try {
    const storage = await getStorage();
    const keys = [set.storage_key, ...items.map((i) => i.storage_key)].filter((k): k is string => !!k);
    for (const k of keys) {
      try {
        await storage.remove(k);
      } catch {
        // 무시
      }
    }
  } catch {
    // 스토리지 미설정 등 — DB 삭제는 이미 완료
  }
  return NextResponse.json({ ok: true });
}
