import { NextRequest, NextResponse } from "next/server";
import { query, generateImage, isImageGenConfigured } from "@vchatbot/core";
import { parseRefImages, collectAssetRefs, withRefNotes, MAX_REFS } from "@/lib/image-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * POST /api/worlds/:id/title-image/generate
 *   { prompt, refImages?: [{ data(base64), mimeType }] }
 * 운영자 도구: 과금 없이 AI 로 세계관 타이틀 이미지를 생성해 base64 로 반환 (저장 안 함 —
 * 클라이언트에서 프리뷰/크롭 후 기존 타이틀 업로드 라우트로 저장).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const worldId = Number(id);
  if (!Number.isInteger(worldId) || worldId <= 0) return bad("id 가 올바르지 않습니다.");
  const rows = await query("SELECT id FROM worlds WHERE id = ?", [worldId]);
  if (rows.length === 0) return bad("찾을 수 없습니다.", 404);

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  // 등록된 세계관 배경 이미지도 참조로 쓸 수 있다
  parsed.refs.push(...(await collectAssetRefs(body, { worldId }, req.nextUrl.origin)));
  if (parsed.refs.length > MAX_REFS) return bad(`참조 이미지는 합산 최대 ${MAX_REFS}장입니다.`);

  if (!(await isImageGenConfigured())) {
    return bad("이미지 생성이 설정되지 않았습니다. 관리자 > LLM 관리 > 이미지 생성 AI 에서 등록하세요.");
  }

  let buffer: Buffer;
  try {
    buffer = await generateImage(withRefNotes(prompt, parsed.refs), parsed.refs);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("admin world title generate error:", e);
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  return NextResponse.json({ image: buffer.toString("base64"), mime: "image/png" }, { status: 201 });
}
