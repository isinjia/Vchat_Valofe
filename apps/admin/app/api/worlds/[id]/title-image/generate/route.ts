import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, generateImage, getImageGenSettings } from "@vchatbot/core";
import { parseRefImages, collectAssetRefs, MAX_REFS } from "@/lib/image-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * POST /api/worlds/:id/title-image/generate
 *   { prompt, refImages?: [{ data(base64), mimeType }] }
 * 운영자 도구: 과금 없이 AI 로 세계관 타이틀 이미지 생성·교체.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const worldId = Number(id);
  if (!Number.isInteger(worldId) || worldId <= 0) return bad("id 가 올바르지 않습니다.");
  const rows = await query<{ title_image_key: string | null }>("SELECT title_image_key FROM worlds WHERE id = ?", [worldId]);
  if (rows.length === 0) return bad("찾을 수 없습니다.", 404);

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  // 등록된 세계관 배경 이미지도 참조로 쓸 수 있다
  parsed.refs.push(...(await collectAssetRefs(body, { worldId }, req.nextUrl.origin)));
  if (parsed.refs.length > MAX_REFS) return bad(`참조 이미지는 합산 최대 ${MAX_REFS}장입니다.`);

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

  let buffer: Buffer;
  try {
    buffer = await generateImage(prompt, parsed.refs);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("admin world title generate error:", e);
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  const oldKey = rows[0].title_image_key;
  const key = `worlds/${worldId}/title-ai-${Date.now()}.png`;
  const url = await storage.upload(key, buffer, "image/png");
  await execute("UPDATE worlds SET title_image_key = ?, title_image_url = ? WHERE id = ?", [key, url, worldId]);
  if (oldKey) {
    try {
      await storage.remove(oldKey);
    } catch {
      // 무시
    }
  }
  return NextResponse.json({ url }, { status: 201 });
}
