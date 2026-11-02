import { NextRequest, NextResponse } from "next/server";
import { query, getBalance, itemAllowedForCharacter, type WorldItemRow } from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/gifts?characterId= — 이 캐릭터에게 쓸 수 있는 선물 아이템 목록 + 내 사용 상태.
 * char_rule(사용 가능/불가 캐릭터)에 걸리는 아이템은 목록에서 제외한다.
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const characterId = Number(req.nextUrl.searchParams.get("characterId"));
  if (!Number.isInteger(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "characterId 가 올바르지 않습니다." }, { status: 400 });
  }

  const chars = await query<{ id: number; world_id: number }>(
    "SELECT id, world_id FROM characters WHERE id = ? AND is_active = 1",
    [characterId]
  );
  if (chars.length === 0) return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  const worldId = chars[0].world_id;

  const items = await query<WorldItemRow>(
    "SELECT * FROM world_items WHERE world_id = ? AND is_active = 1 ORDER BY sort_order, id",
    [worldId]
  );
  const usable = items.filter((i) => itemAllowedForCharacter(i.char_rule, characterId));

  // 내 사용 상태 (이 캐릭터에게): 사용 횟수 + 경과 시간(초, DB 기준 — 타임존 차이 방지)
  const ids = usable.map((i) => i.id);
  const uses = ids.length
    ? await query<{ item_id: number; cnt: number; since_sec: number }>(
        `SELECT item_id, COUNT(*) AS cnt, TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS since_sec
         FROM item_uses
         WHERE user_id = ? AND character_id = ? AND item_id IN (${ids.map(() => "?").join(",")})
         GROUP BY item_id`,
        [userId, characterId, ...ids]
      )
    : [];
  const useMap = new Map(uses.map((u) => [u.item_id, u]));

  return NextResponse.json({
    balance: await getBalance(userId),
    items: usable.map((i) => {
      const u = useMap.get(i.id);
      const used = Number(u?.cnt ?? 0);
      const remainSec =
        u && Number(i.cooldown_hours) > 0 ? Number(i.cooldown_hours) * 3600 - Number(u.since_sec) : 0;
      const nextAt = remainSec > 0 ? Date.now() + remainSec * 1000 : null;
      const max = Number(i.max_uses_per_character);
      return {
        id: i.id,
        name: i.name,
        description: i.description,
        icon_url: i.icon_url,
        image_url: i.image_url,
        price: Number(i.price),
        reset_affinity: !!i.reset_affinity,
        cooldown_hours: Number(i.cooldown_hours),
        maxUses: max,
        usedCount: used,
        remaining: max > 0 ? Math.max(0, max - used) : null,
        /** 쿨다운 해제 시각 (지났으면 null) */
        nextAvailableAt: nextAt != null ? new Date(nextAt).toISOString() : null,
      };
    }),
  });
}
