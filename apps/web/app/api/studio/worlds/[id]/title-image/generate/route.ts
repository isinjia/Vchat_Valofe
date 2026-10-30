import { NextRequest, NextResponse } from "next/server";
import {
  query,
  execute,
  getStorage,
  generateImage,
  getImageGenSettings,
  chargeCoins,
  getPricingSettings,
} from "@vchatbot/core";
import { requireUser, ownedWorld, bad } from "@/lib/studio";
import { parseRefImages, collectAssetRefs, MAX_REFS } from "@/lib/image-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/studio/worlds/:id/title-image/generate
 *   { prompt, refImages?: [{ data(base64), mimeType }] (최대 2개, 각 10MB 이하) }
 * AI 로 세계관 타이틀 이미지를 생성해 교체. 생성·저장 성공 후에만 코인 차감.
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
    console.error("studio world title generate error:", e);
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  const rows = await query<{ title_image_key: string | null }>("SELECT title_image_key FROM worlds WHERE id = ?", [worldId]);
  const oldKey = rows[0]?.title_image_key;
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

  const cost = (await getPricingSettings()).illustGenCost;
  const balance = await chargeCoins(auth.userId, cost, "illust_gen_spend", { refType: "world", refId: worldId });
  return NextResponse.json({ url, cost, balance }, { status: 201 });
}
