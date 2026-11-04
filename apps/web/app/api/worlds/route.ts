import { NextResponse } from "next/server";
import { query, cached } from "@vchatbot/core";
import { getUserId, isAdultUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/**
 * GET /api/worlds — 활성 세계관 목록 (메인 필터용, 좋아요 많은 순)
 * 이벤트 기반 캐시: 세계관 추가/수정/삭제·좋아요 토글 시 즉시 무효화.
 * TTL 1시간은 무효화를 거치지 않는 변경(시드 스크립트, 수동 SQL)에 대비한 안전망.
 */
export async function GET() {
  // 19금 세계관: 성인 확인된 유저에게만 노출 (캐시도 성인/일반 분리)
  const adultViewer = await isAdultUser(await getUserId());
  const rows = await cached(`cache:web:worlds:${adultViewer ? "a" : "g"}`, 3600, () =>
    query<{
      id: number;
      name: string;
      title_image_url: string | null;
      title_color: string | null;
      like_count: number;
      owner_name: string | null;
    }>(
      `SELECT w.id, w.name, w.title_image_url, w.title_color, w.like_count, w.is_adult, uo.nickname AS owner_name
       FROM worlds w LEFT JOIN users uo ON uo.id = w.owner_user_id
       WHERE w.is_active = 1 AND w.visibility = 'open' AND w.status = 'active' AND w.delete_scheduled_at IS NULL
         ${adultViewer ? "" : "AND w.is_adult = 0"}
       ORDER BY w.like_count DESC, w.id`
    )
  );
  return NextResponse.json(rows);
}
