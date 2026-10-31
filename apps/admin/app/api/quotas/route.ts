import { NextRequest, NextResponse } from "next/server";
import { query, execute, setSetting, getUploadLimitSettings } from "@vchatbot/core";

export const dynamic = "force-dynamic";

/** GET: 업로드 쿼터 — 전역 기본값 + 크리에이터 등급별 제한 목록 */
export async function GET() {
  const uploads = await getUploadLimitSettings();
  const tiers = await query(
    `SELECT id, name, tier_rank, video_max_mb, effect_max_mb
     FROM chat_tiers WHERE track = 'creator' ORDER BY tier_rank, id`
  );
  return NextResponse.json({ uploads, tiers });
}

/** PUT: { uploads: { videoMaxMb, effectMaxMb }, tiers: [{ id, video_max_mb|null, effect_max_mb|null }] } */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (body.uploads) {
    const pos = (x: unknown, d: number) => {
      const n = Number(x);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
    };
    await setSetting("uploads", {
      videoMaxMb: pos(body.uploads.videoMaxMb, 100),
      effectMaxMb: pos(body.uploads.effectMaxMb, 2),
    });
  }

  if (Array.isArray(body.tiers)) {
    // 비우면(NULL) 전역 기본값 사용
    const orNull = (x: unknown) => {
      if (x == null || x === "") return null;
      const n = Number(x);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };
    for (const t of body.tiers) {
      const id = Number(t?.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      await execute(
        "UPDATE chat_tiers SET video_max_mb = ?, effect_max_mb = ? WHERE id = ? AND track = 'creator'",
        [orNull(t.video_max_mb), orNull(t.effect_max_mb), id]
      );
    }
  }

  return NextResponse.json({ ok: true });
}
