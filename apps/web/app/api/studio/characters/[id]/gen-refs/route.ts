import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { requireUser, ownedCharacter } from "@/lib/studio";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/studio/characters/:id/gen-refs
 * AI 이미지 생성 다이얼로그용 참조 자산 목록:
 * 캐릭터 타이틀/감정 프로필/등록 일러스트 + 세계관 지역사전(location) + 세계관 배경 이미지
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const cid = Number(id);
  const worldId = Number(own.row.world_id);

  const [profiles, illustrations, places, worldIllustrations] = await Promise.all([
    query("SELECT id, emotion, url FROM character_profiles WHERE character_id = ? ORDER BY FIELD(emotion,'default') DESC, emotion", [cid]),
    query("SELECT id, url, description, kind FROM illustrations WHERE character_id = ? ORDER BY kind, sort_order, id", [cid]),
    query(
      "SELECT id, title, content FROM world_dictionary WHERE world_id = ? AND category = 'location' AND character_id IS NULL ORDER BY sort_order, id",
      [worldId]
    ),
    query(
      `SELECT wi.id, wi.dict_entry_id, wi.url, wi.description, d.title AS place_title
       FROM world_illustrations wi LEFT JOIN world_dictionary d ON d.id = wi.dict_entry_id
       WHERE wi.world_id = ? ORDER BY wi.dict_entry_id IS NULL DESC, wi.dict_entry_id, wi.sort_order, wi.id`,
      [worldId]
    ),
  ]);

  return NextResponse.json({
    titleImageUrl: (own.row as { title_image_url?: string | null }).title_image_url ?? null,
    profiles,
    illustrations,
    places,
    worldIllustrations,
  });
}
