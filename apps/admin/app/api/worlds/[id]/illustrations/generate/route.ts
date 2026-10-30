import { NextRequest, NextResponse } from "next/server";
import {
  query,
  execute,
  getStorage,
  generateImage,
  getImageGenSettings,
} from "@vchatbot/core";
import { parseRefImages, fetchRefImage, collectAssetRefs, MAX_REFS } from "@/lib/image-refs";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/worlds/:id/illustrations/generate
 *   { prompt, dictEntryId?(location 사전 항목, 없으면 세계관 공통), description?,
 *     refTitleImage?, refImages?, refWorldIllustIds? }
 * 운영자 도구: 과금 없이 AI 로 지역 배경 이미지를 생성해 세계관 일러스트로 저장.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const worldId = Number(id);
  const exists = await query("SELECT id FROM worlds WHERE id = ?", [worldId]);
  if (exists.length === 0) return bad("찾을 수 없습니다.", 404);

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

  let dictEntryId: number | null = null;
  if (body.dictEntryId != null && body.dictEntryId !== "") {
    const n = Number(body.dictEntryId);
    if (!Number.isInteger(n) || n <= 0) return bad("dictEntryId 가 올바르지 않습니다.");
    const rows = await query(
      "SELECT id FROM world_dictionary WHERE id = ? AND world_id = ? AND category = 'location'",
      [n, worldId]
    );
    if (rows.length === 0) return bad("이 세계관의 지역사전 항목이 아닙니다.");
    dictEntryId = n;
  }

  const ig = await getImageGenSettings();
  if (!ig.enabled || !ig.apiKey) {
    return bad("이미지 생성이 설정되지 않았습니다. 관리자 설정에서 이미지 생성 API 를 등록하세요.");
  }
  let storage;
  try {
    storage = await getStorage();
  } catch (e) {
    return bad((e as Error).message);
  }

  // 참조 이미지: 업로드(base64) + 기존 세계관 배경 + (선택) 세계관 타이틀 이미지
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  const refs = parsed.refs;
  refs.push(...(await collectAssetRefs(body, { worldId }, req.nextUrl.origin)));
  if (body.refTitleImage === true) {
    const t = await query<{ title_image_url: string | null }>("SELECT title_image_url FROM worlds WHERE id = ?", [worldId]);
    const tr = await fetchRefImage(t[0]?.title_image_url, req.nextUrl.origin);
    if (tr) refs.unshift(tr);
  }
  if (refs.length > MAX_REFS) return bad(`참조 이미지는 합산 최대 ${MAX_REFS}장입니다.`);

  let buffer: Buffer;
  try {
    buffer = await generateImage(prompt, refs);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("admin world illust generate error:", e);
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  const key = `world-illustrations/${worldId}/ai-${Date.now()}.png`;
  const url = await storage.upload(key, buffer, "image/png");
  const result = await execute(
    `INSERT INTO world_illustrations (world_id, dict_entry_id, storage_key, url, description, sort_order)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [worldId, dictEntryId, key, url, description]
  );
  return NextResponse.json({ id: result.insertId, url }, { status: 201 });
}
