import { NextRequest, NextResponse } from "next/server";
import {
  listAiLevels,
  resolveAiLevelForUser,
  setUserAiLevel,
  resolveTierId,
  query,
} from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

/** 유저 등급의 할인율(%) */
async function userDiscount(userId: number): Promise<number> {
  const tierId = await resolveTierId(userId);
  if (tierId == null) return 0;
  const rows = await query<{ discount_rate: number | string }>(
    "SELECT discount_rate FROM chat_tiers WHERE id = ?",
    [tierId]
  );
  return Math.min(100, Math.max(0, Number(rows[0]?.discount_rate) || 0));
}

async function levelsPayload(userId: number) {
  const [levels, discount, effective, me] = await Promise.all([
    listAiLevels(true),
    userDiscount(userId),
    resolveAiLevelForUser(userId),
    query<{ ai_level_id: number | null }>("SELECT ai_level_id FROM users WHERE id = ?", [userId]),
  ]);
  return {
    levels: levels.map((l) => ({
      id: l.id,
      level: l.level,
      name: l.name,
      description: l.description,
      kind: l.kind,
      /** 유저 등급 할인이 적용된 1회 비용 */
      cost: Math.max(0, Math.ceil(Number(l.chat_cost) * (1 - discount / 100))),
    })),
    selectedId: me[0]?.ai_level_id ?? null,
    effectiveId: effective?.id ?? null,
    effectiveKind: effective?.kind ?? "server",
    discount,
  };
}

/** GET: 선택 가능한 AI 레벨 목록(할인 반영 비용) + 내 선택 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });
  return NextResponse.json(await levelsPayload(userId));
}

/** PUT { levelId: number | null } — 내 AI 레벨 선택 */
export async function PUT(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const levelId = body.levelId == null ? null : Number(body.levelId);
  if (levelId != null && (!Number.isInteger(levelId) || levelId < 1)) {
    return NextResponse.json({ error: "levelId 가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    await setUserAiLevel(userId, levelId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json(await levelsPayload(userId));
}
