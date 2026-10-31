import { NextRequest, NextResponse } from "next/server";
import {
  query,
  generateImage,
  getImageGenSettings,
  chargeCoins,
  getPricingSettings,
} from "@vchatbot/core";
import { parseRefImages, fetchRefImage, collectAssetRefs, withRefNotes, MAX_REFS } from "@/lib/image-refs";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

const EMOTIONS = ["default", "joy", "sad", "angry", "shy", "surprised", "love", "neutral"];

/**
 * POST /api/studio/characters/:id/profiles/generate
 *   { emotion, prompt, useTitleRef?, useDefaultProfileRef?, refImages? }
 * AI 로 프로필 이미지를 생성해 base64 로 반환 (저장 안 함 — 클라이언트에서 프리뷰/크롭 후
 * 기존 업로드 라우트로 저장). 생성 성공 시 회당 차감.
 * 참조 순서: 타이틀 이미지 → 기본 프로필 → 업로드(base64)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const cid = Number(id);

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");
  const emotion = typeof body.emotion === "string" ? body.emotion : "";
  if (!EMOTIONS.includes(emotion)) return bad("emotion 이 올바르지 않습니다.");

  const ig = await getImageGenSettings();
  if (!ig.enabled || !ig.apiKey) {
    return bad("이미지 생성이 설정되지 않았습니다. 관리자 설정에서 이미지 생성 API 를 등록하세요.");
  }

  // 참조 수집: 업로드(base64) 뒤에 타이틀/기본 프로필을 앞쪽으로 끼워 넣는다
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  const refs = parsed.refs;
  const front: NonNullable<Awaited<ReturnType<typeof fetchRefImage>>>[] = [];
  if (body.useTitleRef === true) {
    const t = await query<{ title_image_url: string | null }>("SELECT title_image_url FROM characters WHERE id = ?", [cid]);
    const r = await fetchRefImage(t[0]?.title_image_url, req.nextUrl.origin, "이 캐릭터의 대표(타이틀) 이미지 — 외형 기준");
    if (r) front.push(r);
  }
  if (body.useDefaultProfileRef === true && emotion !== "default") {
    const d = await query<{ url: string | null }>(
      "SELECT url FROM character_profiles WHERE character_id = ? AND emotion = 'default'",
      [cid]
    );
    const r = await fetchRefImage(d[0]?.url, req.nextUrl.origin, "이 캐릭터의 기본 프로필 이미지 — 같은 인물·같은 화풍 기준");
    if (r) front.push(r);
  }
  refs.push(...(await collectAssetRefs(body, { characterId: cid, worldId: Number(own.row.world_id), userId: auth.userId }, req.nextUrl.origin)));
  refs.unshift(...front);
  if (refs.length > MAX_REFS) return bad(`참조 이미지는 합산 최대 ${MAX_REFS}장입니다.`);

  let buffer: Buffer;
  try {
    buffer = await generateImage(withRefNotes(prompt, refs), refs);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("studio profile generate error:", e);
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
