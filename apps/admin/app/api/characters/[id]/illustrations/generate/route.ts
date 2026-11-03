import { buildIllustTrigger, validateTriggerPlace } from "@/lib/illust-trigger";
import { NextRequest, NextResponse } from "next/server";
import { query, generateImage, isImageGenConfigured } from "@vchatbot/core";
import { parseRefImages, fetchRefImage, collectAssetRefs, withRefNotes, MAX_REFS } from "@/lib/image-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * POST /api/characters/:id/illustrations/generate
 *   { prompt, kind: 'basic'|'conditional', keywords?, description?, asTitle? }
 * 운영자 도구: 로그인/과금 없이 AI 이미지를 생성해 base64 로 반환한다 (저장 안 함 —
 * 클라이언트에서 프리뷰/크롭 후 기존 업로드 라우트로 저장). 조건 입력은 사전 검증만.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const characterId = Number(id);
  if (!Number.isInteger(characterId) || characterId <= 0) return bad("id 가 올바르지 않습니다.");
  const exists = await query<{ world_id: number }>("SELECT id, world_id FROM characters WHERE id = ?", [characterId]);
  if (exists.length === 0) return bad("찾을 수 없습니다.", 404);

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");
  const kind = body.kind === "conditional" ? "conditional" : "basic";
  const asTitle = body.asTitle === true;

  if (!asTitle && kind === "conditional") {
    const t = buildIllustTrigger(body);
    if ("error" in t) return bad(t.error);
    const placeErr = await validateTriggerPlace(t.value, Number(exists[0].world_id));
    if (placeErr) return bad(placeErr);
  }

  // 스토리지 접근/외부 호출 전에 설정 여부부터 확인
  if (!(await isImageGenConfigured())) {
    return bad("이미지 생성이 설정되지 않았습니다. 관리자 > LLM 관리 > 이미지 생성 AI 에서 등록하세요.");
  }

  // 참조 이미지: 업로드(base64) + (선택) 캐릭터 타이틀 이미지
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  const refs = parsed.refs;
  refs.push(...(await collectAssetRefs(body, { characterId, worldId: Number(exists[0].world_id) }, req.nextUrl.origin)));
  if (body.refTitleImage === true) {
    const t = await query<{ title_image_url: string | null }>("SELECT title_image_url FROM characters WHERE id = ?", [characterId]);
    const tr = await fetchRefImage(t[0]?.title_image_url, req.nextUrl.origin, "이 캐릭터의 대표(타이틀) 이미지 — 외형 기준");
    if (tr) refs.unshift(tr);
  }
  if (refs.length > MAX_REFS) return bad(`참조 이미지는 합산 최대 ${MAX_REFS}장입니다.`);

  let buffer: Buffer;
  try {
    buffer = await generateImage(withRefNotes(prompt, refs), refs);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("admin illust generate error:", e);
    // 설정 미등록은 400, 외부 API 오류는 502
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  return NextResponse.json({ image: buffer.toString("base64"), mime: "image/png" }, { status: 201 });
}
