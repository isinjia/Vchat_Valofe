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
import { PROFILE_EMOTIONS } from "@/lib/profile-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string; sid: string }> };

/**
 * POST /api/studio/characters/:id/profile-sets/:sid/items/generate
 *   { emotion, prompt, refTitleImage?, refImages?, refProfileIds?, refIllustIds?, refWorldIllustIds? }
 * 얼굴세트 감정별 이미지를 AI 로 생성해 base64 로 반환 (저장 안 함 — 프리뷰/크롭/색 지우개 후
 * items 업로드 라우트로 저장). 투명 배경 요청: openai 계열은 알파 PNG, gemini 는 마젠타 단색 배경.
 * 생성 성공 시 회당 차감.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, sid } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const cid = Number(id);

  const sets = await query<{ id: number; category: string }>(
    "SELECT id, category FROM character_profile_sets WHERE id = ? AND character_id = ?",
    [Number(sid), cid]
  );
  if (sets.length === 0) return bad("세트를 찾을 수 없습니다.", 404);
  if (sets[0].category !== "face") return bad("AI 얼굴 생성은 얼굴세트에서만 가능합니다.");

  const body = await req.json().catch(() => ({}));
  const emotion = String(body.emotion ?? "default");
  if (!PROFILE_EMOTIONS.includes(emotion)) return bad("emotion 이 올바르지 않습니다.");
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");

  if (!(await isImageGenConfigured())) {
    return bad("이미지 생성이 설정되지 않았습니다. 관리자 > LLM 관리 > 이미지 생성 AI 에서 등록하세요.");
  }

  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  const refs = parsed.refs;
  refs.push(...(await collectAssetRefs(body, { characterId: cid, worldId: Number(own.row.world_id), userId: auth.userId }, req.nextUrl.origin)));
  if (body.refTitleImage === true) {
    const t = await query<{ title_image_url: string | null }>("SELECT title_image_url FROM characters WHERE id = ?", [cid]);
    const tr = await fetchRefImage(t[0]?.title_image_url, req.nextUrl.origin, "이 캐릭터의 대표(타이틀) 이미지 — 외형 기준");
    if (tr) refs.unshift(tr);
  }
  if (refs.length > MAX_REFS) return bad(`참조 이미지는 합산 최대 ${MAX_REFS}장입니다.`);

  let buffer: Buffer;
  try {
    buffer = await generateImage(withRefNotes(prompt, refs), refs, { transparent: true });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("studio profile-set face generate error:", e);
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  // 생성 성공 후 차감 — 결과는 저장하지 않고 반환 (재생성할 때마다 다시 차감)
  const cost = (await getPricingSettings()).illustGenCost;
  const balance = await chargeCoins(auth.userId, cost, "illust_gen_spend", { refType: "character", refId: cid });
  return NextResponse.json(
    { emotion, image: buffer.toString("base64"), mime: "image/png", cost, balance },
    { status: 201 }
  );
}
