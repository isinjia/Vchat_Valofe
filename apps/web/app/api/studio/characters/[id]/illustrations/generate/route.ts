import { buildIllustTrigger, validateTriggerPlace } from "@/lib/illust-trigger";
import { NextRequest, NextResponse } from "next/server";
import {
  query,
  generateImage,
  isImageGenConfigured,
  chargeCoins,
  getPricingSettings,
} from "@vchatbot/core";
import { parseRefImages, fetchRefImage, collectAssetRefs, withRefNotes, MAX_REFS } from "@/lib/image-refs";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/studio/characters/:id/illustrations/generate
 *   { prompt, kind: 'basic'|'conditional', keywords?, ref* }
 * AI 로 이미지를 생성해 base64 로 반환한다 (저장 안 함 — 클라이언트에서 프리뷰/크롭 후
 * 기존 업로드 라우트로 저장). 조건 입력은 결제 전에 미리 검증만 한다. 생성 성공 시 회당 차감.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const characterId = Number(id);

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");
  const kind = body.kind === "conditional" ? "conditional" : "basic";

  // 조건 입력 사전 검증 (실제 저장 시 업로드 라우트가 다시 검증)
  if (body.asTitle !== true && kind === "conditional") {
    const t = buildIllustTrigger(body);
    if ("error" in t) return bad(t.error);
    const placeErr = await validateTriggerPlace(t.value, Number(own.row.world_id));
    if (placeErr) return bad(placeErr);
  }

  // 외부 호출 전에 설정 여부부터 확인
  if (!(await isImageGenConfigured())) {
    return bad("이미지 생성이 설정되지 않았습니다. 관리자 > LLM 관리 > 이미지 생성 AI 에서 등록하세요.");
  }

  // 참조 이미지: 업로드(base64) + 등록 자산(프로필/일러스트/세계관 배경) + (선택) 캐릭터 타이틀 이미지
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  const refs = parsed.refs;
  const assetRefs = await collectAssetRefs(body, { characterId, worldId: Number(own.row.world_id), userId: auth.userId }, req.nextUrl.origin);
  refs.push(...assetRefs);
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
    console.error("studio illust generate error:", e);
    // 설정 미등록은 400, 외부 API 오류는 502
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  // 생성 성공 후 차감 — 결과는 저장하지 않고 반환 (재생성할 때마다 다시 차감)
  const cost = (await getPricingSettings()).illustGenCost;
  const balance = await chargeCoins(auth.userId, cost, "illust_gen_spend", {
    refType: "character",
    refId: characterId,
  });
  return NextResponse.json(
    { image: buffer.toString("base64"), mime: "image/png", cost, balance },
    { status: 201 }
  );
}
