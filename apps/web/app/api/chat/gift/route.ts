import { NextRequest, NextResponse } from "next/server";
import {
  query,
  execute,
  chargeGiftWithFees,
  applyGiftAffinity,
  itemAllowedForCharacter,
  invalidateCachePattern,
  type WorldItemRow,
} from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * POST /api/chat/gift { characterId, itemId } — 선물 사용.
 * 검증(활성/사용 가능 캐릭터/쿨다운/횟수) → 코인 차감 + 제작자·세계관 수수료 분배 →
 * 호감도 효과(초기화 또는 기본+캐릭터 보너스) → item_uses 기록.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return bad("로그인이 필요합니다.", 401);
  const body = await req.json().catch(() => ({}));
  const characterId = Number(body.characterId);
  const itemId = Number(body.itemId);
  if (!Number.isInteger(characterId) || characterId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
    return bad("characterId, itemId 가 올바르지 않습니다.");
  }

  const chars = await query<{ id: number; world_id: number; owner_user_id: number | null; world_owner: number | null }>(
    `SELECT c.id, c.world_id, c.owner_user_id, w.owner_user_id AS world_owner
     FROM characters c JOIN worlds w ON w.id = c.world_id
     WHERE c.id = ? AND c.is_active = 1`,
    [characterId]
  );
  if (chars.length === 0) return bad("캐릭터를 찾을 수 없습니다.", 404);
  const ch = chars[0];

  const items = await query<WorldItemRow>(
    "SELECT * FROM world_items WHERE id = ? AND world_id = ? AND is_active = 1",
    [itemId, ch.world_id]
  );
  if (items.length === 0) return bad("사용할 수 없는 아이템입니다.", 404);
  const item = items[0];
  if (!itemAllowedForCharacter(item.char_rule, characterId)) {
    return bad("이 캐릭터에게는 사용할 수 없는 아이템입니다.");
  }

  // 횟수/쿨다운 검증 — 시간 비교는 타임존 차이를 피하려고 DB(NOW()) 기준으로 계산
  const stats = await query<{ cnt: number; wait_sec: number | null }>(
    `SELECT COUNT(*) AS cnt,
            TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(MAX(created_at), INTERVAL ? HOUR)) AS wait_sec
     FROM item_uses WHERE user_id = ? AND character_id = ? AND item_id = ?`,
    [Number(item.cooldown_hours), userId, characterId, itemId]
  );
  const used = Number(stats[0]?.cnt ?? 0);
  const max = Number(item.max_uses_per_character);
  if (max > 0 && used >= max) return bad("이 캐릭터에게 더 이상 사용할 수 없는 아이템입니다. (횟수 소진)");
  const waitSec = Number(stats[0]?.wait_sec ?? 0);
  if (item.cooldown_hours > 0 && used > 0 && waitSec > 0) {
    const h = Math.floor(waitSec / 3600);
    const m = Math.ceil((waitSec % 3600) / 60);
    return bad(`아직 다시 사용할 수 없습니다. (${h > 0 ? `${h}시간 ` : ""}${m}분 후 가능)`);
  }

  // 차감 + 수수료 분배
  const { balance, creatorFee, worldFee } = await chargeGiftWithFees(
    userId,
    Number(item.price),
    { characterId, characterOwnerId: ch.owner_user_id, worldId: ch.world_id, worldOwnerId: ch.world_owner },
    `선물: ${item.name}`
  );

  // 호감도 효과
  const bonusRows = await query<{ bonus_affinity: number }>(
    "SELECT bonus_affinity FROM world_item_characters WHERE item_id = ? AND character_id = ?",
    [itemId, characterId]
  );
  const bonus = Number(bonusRows[0]?.bonus_affinity ?? 0);
  const { before, after } = await applyGiftAffinity(userId, characterId, item, bonus);

  await execute(
    `INSERT INTO item_uses (item_id, item_name, world_id, user_id, character_id, price, affinity_applied, creator_fee, world_fee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [itemId, item.name, ch.world_id, userId, characterId, Number(item.price), after - before, creatorFee, worldFee]
  );

  // 받은 선물 정렬이 있는 캐릭터 목록 캐시 무효화
  await invalidateCachePattern("cache:web:chars:*");

  return NextResponse.json({
    ok: true,
    balance,
    affinityBefore: before,
    affinityAfter: after,
    affinityDelta: after - before,
    item: { id: item.id, name: item.name, image_url: item.image_url },
  });
}
