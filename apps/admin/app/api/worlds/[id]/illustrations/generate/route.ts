import { NextRequest, NextResponse } from "next/server";
import { query, generateImage, getImageGenSettings } from "@vchatbot/core";
import { parseRefImages, fetchRefImage, collectAssetRefs, withRefNotes, MAX_REFS } from "@/lib/image-refs";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/worlds/:id/illustrations/generate
 *   { prompt, dictEntryId?(location 사전 항목, 없으면 세계관 공통), description?,
 *     refTitleImage?, refImages?, refWorldIllustIds? }
 * 운영자 도구: 과금 없이 AI 로 지역 배경 이미지를 생성해 base64 로 반환 (저장 안 함 — dictEntryId 는 사전 검증만).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const worldId = Number(id);
  const exists = await query("SELECT id FROM worlds WHERE id = ?", [worldId]);
  if (exists.length === 0) return bad("찾을 수 없습니다.", 404);

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");

  if (body.dictEntryId != null && body.dictEntryId !== "") {
    const n = Number(body.dictEntryId);
    if (!Number.isInteger(n) || n <= 0) return bad("dictEntryId 가 올바르지 않습니다.");
    const rows = await query(
      "SELECT id FROM world_dictionary WHERE id = ? AND world_id = ? AND category = 'location'",
      [n, worldId]
    );
    if (rows.length === 0) return bad("이 세계관의 지역사전 항목이 아닙니다.");
  }

  const ig = await getImageGenSettings();
  if (!ig.enabled || !ig.apiKey) {
    return bad("이미지 생성이 설정되지 않았습니다. 관리자 설정에서 이미지 생성 API 를 등록하세요.");
  }

  // 참조 이미지: 업로드(base64) + 기존 세계관 배경 + (선택) 세계관 타이틀 이미지
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  const refs = parsed.refs;
  refs.push(...(await collectAssetRefs(body, { worldId }, req.nextUrl.origin)));
  if (body.refTitleImage === true) {
    const t = await query<{ title_image_url: string | null }>("SELECT title_image_url FROM worlds WHERE id = ?", [worldId]);
    const tr = await fetchRefImage(t[0]?.title_image_url, req.nextUrl.origin, "이 세계관의 대표(타이틀) 이미지 — 화풍·분위기 기준");
    if (tr) refs.unshift(tr);
  }
  if (refs.length > MAX_REFS) return bad(`참조 이미지는 합산 최대 ${MAX_REFS}장입니다.`);

  let buffer: Buffer;
  try {
    buffer = await generateImage(withRefNotes(prompt, refs), refs);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("admin world illust generate error:", e);
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  return NextResponse.json({ image: buffer.toString("base64"), mime: "image/png" }, { status: 201 });
}
