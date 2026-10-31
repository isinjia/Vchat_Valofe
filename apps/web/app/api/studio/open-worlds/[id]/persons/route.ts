import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { requireUser, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * GET: 공개 세계관의 공용 인명사전 중 아직 캐릭터가 연결되지 않은 인물 목록.
 * 인명사전 한정(open_scope='dict_person') 세계관에서 캐릭터를 만들 때,
 * 만들 수 있는 이름을 고를 수 있도록 노출한다. (내 세계관이면 전체 조회 가능이라 불필요)
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const worldId = Number(id);
  if (!Number.isInteger(worldId) || worldId <= 0) return bad("id 가 올바르지 않습니다.");

  const worlds = await query<{ id: number }>(
    `SELECT id FROM worlds
     WHERE id = ? AND (visibility = 'open' AND status = 'active' OR owner_user_id = ?)`,
    [worldId, auth.userId]
  );
  if (worlds.length === 0) return bad("찾을 수 없습니다.", 404);

  const rows = await query(
    `SELECT d.id, d.title
     FROM world_dictionary d
     WHERE d.world_id = ? AND d.category = 'person' AND d.character_id IS NULL
       AND d.linked_character_id IS NULL
     ORDER BY d.sort_order, d.id`,
    [worldId]
  );
  return NextResponse.json(rows);
}
