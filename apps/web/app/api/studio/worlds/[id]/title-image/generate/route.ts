import { NextRequest, NextResponse } from "next/server";
import {
  generateImage,
  isImageGenConfigured,
  chargeCoins,
  getPricingSettings,
} from "@vchatbot/core";
import { requireUser, ownedWorld, bad } from "@/lib/studio";
import { parseRefImages, collectAssetRefs, withRefNotes, MAX_REFS } from "@/lib/image-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/studio/worlds/:id/title-image/generate
 *   { prompt, refImages?: [{ data(base64), mimeType }] (최대 2개, 각 10MB 이하) }
 * AI 로 세계관 타이틀 이미지를 생성해 base64 로 반환 (저장 안 함 — 클라이언트에서
 * 프리뷰/크롭 후 기존 타이틀 업로드 라우트로 저장). 생성 성공 시 회당 차감.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  const worldId = Number(id);

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  // 등록된 세계관 배경 이미지도 참조로 쓸 수 있다
  parsed.refs.push(...(await collectAssetRefs(body, { worldId, userId: auth.userId }, req.nextUrl.origin)));
  if (parsed.refs.length > MAX_REFS) return bad(`참조 이미지는 합산 최대 ${MAX_REFS}장입니다.`);

  if (!(await isImageGenConfigured())) {
    return bad("이미지 생성이 설정되지 않았습니다. 관리자 > LLM 관리 > 이미지 생성 AI 에서 등록하세요.");
  }

  let buffer: Buffer;
  try {
    buffer = await generateImage(withRefNotes(prompt, parsed.refs), parsed.refs);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("studio world title generate error:", e);
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  // 생성 성공 후 차감 — 결과는 저장하지 않고 반환 (재생성할 때마다 다시 차감)
  const cost = (await getPricingSettings()).illustGenCost;
  const balance = await chargeCoins(auth.userId, cost, "illust_gen_spend", { refType: "world", refId: worldId });
  return NextResponse.json(
    { image: buffer.toString("base64"), mime: "image/png", cost, balance },
    { status: 201 }
  );
}
