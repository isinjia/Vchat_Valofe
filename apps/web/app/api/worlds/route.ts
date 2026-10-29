import { NextResponse } from "next/server";
import { query, cached } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/**
 * GET /api/worlds — 활성 세계관 목록 (메인 필터용)
 * 이벤트 기반 캐시: 세계관 추가/수정/삭제 시 invalidateChatContext 가 즉시 무효화.
 * TTL 1시간은 무효화를 거치지 않는 변경(시드 스크립트, 수동 SQL)에 대비한 안전망.
 */
export async function GET() {
  const rows = await cached("cache:web:worlds", 3600, () =>
    query<{ id: number; name: string; title_image_url: string | null }>(
      "SELECT id, name, title_image_url FROM worlds WHERE is_active = 1 AND visibility = 'open' AND status = 'active' ORDER BY id"
    )
  );
  return NextResponse.json(rows);
}
