import { buildIllustTrigger, validateTriggerPlace } from "@/lib/illust-trigger";
import { NextRequest, NextResponse } from "next/server";
import {
  query,
  execute,
  getStorage,
  invalidateChatContext,
  generateVideo,
  resolveVideoProvider,
  chargeCoins,
  getPricingSettings,
} from "@vchatbot/core";
import { parseRefImages, fetchRefImage, collectAssetRefs, withRefNotes } from "@/lib/image-refs";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/studio/characters/:id/illustrations/generate-video
 *   { prompt, kind: 'basic'|'conditional', keywords?, description?, ref* }
 * AI 로 영상을 생성해 일러스트(media_type='video')로 저장. 생성·저장 성공 후에만 코인 차감.
 * 참조 이미지는 1장만 지원 (Sora input_reference / Veo 첫 프레임).
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
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

  let triggerCondition: string | null = null;
  if (kind === "conditional") {
    const t = buildIllustTrigger(body);
    if ("error" in t) return bad(t.error);
    triggerCondition = t.value;
    const placeErr = await validateTriggerPlace(triggerCondition, Number(own.row.world_id));
    if (placeErr) return bad(placeErr);
  }

  // 외부 호출 전에 프로바이더 설정 여부부터 확인
  const vp = await resolveVideoProvider();
  if (!vp || !vp.api_key) {
    return bad("영상 생성이 설정되지 않았습니다. 관리자 > LLM 관리 > 영상 생성 AI 에서 등록하세요.");
  }

  let storage;
  try {
    storage = await getStorage();
  } catch (e) {
    return bad((e as Error).message);
  }

  // 참조 이미지: 업로드(base64) + 등록 자산 + (선택) 타이틀 이미지 — 영상은 1장만 사용
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  const refs = parsed.refs;
  refs.push(...(await collectAssetRefs(body, { characterId, worldId: Number(own.row.world_id), userId: auth.userId }, req.nextUrl.origin)));
  if (body.refTitleImage === true) {
    const t = await query<{ title_image_url: string | null }>("SELECT title_image_url FROM characters WHERE id = ?", [characterId]);
    const tr = await fetchRefImage(t[0]?.title_image_url, req.nextUrl.origin, "이 캐릭터의 대표(타이틀) 이미지 — 외형 기준");
    if (tr) refs.unshift(tr);
  }
  if (refs.length > 1) return bad("영상 생성의 참조 이미지는 1장까지만 선택할 수 있습니다.");

  let buffer: Buffer;
  try {
    buffer = await generateVideo(withRefNotes(prompt, refs), refs[0] ?? null);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("studio video generate error:", e);
    return bad(msg, msg.startsWith("영상 생성이 설정되지") || msg.includes("등록되지 않았습니다") ? 400 : 502);
  }

  const key = `illustrations/${characterId}/ai-${Date.now()}.mp4`;
  const url = await storage.upload(key, buffer, "video/mp4");
  const result = await execute(
    `INSERT INTO illustrations (character_id, kind, media_type, storage_key, url, description, trigger_condition, sort_order)
     VALUES (?, ?, 'video', ?, ?, ?, ?, 0)`,
    [characterId, kind, key, url, description, triggerCondition]
  );
  await invalidateChatContext(characterId);

  // 생성 성공 후 차감
  const cost = (await getPricingSettings()).videoGenCost;
  const balance = await chargeCoins(auth.userId, cost, "video_gen_spend", {
    refType: "character",
    refId: characterId,
  });
  return NextResponse.json({ url, id: result.insertId, cost, balance }, { status: 201 });
}
