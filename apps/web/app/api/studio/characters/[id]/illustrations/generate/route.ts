import { buildIllustTrigger } from "@/lib/illust-trigger";
import { NextRequest, NextResponse } from "next/server";
import {
  query,
  execute,
  getStorage,
  invalidateChatContext,
  generateImage,
  getImageGenSettings,
  chargeCoins,
  getPricingSettings,
} from "@vchatbot/core";
import { parseRefImages, fetchRefImage } from "@/lib/image-refs";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/studio/characters/:id/illustrations/generate
 *   { prompt, kind: 'basic'|'conditional', keywords?, description?, asTitle? }
 * AI 로 이미지를 생성해 일러스트(또는 타이틀 이미지)로 저장. 생성·저장 성공 후에만 코인 차감.
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
  const asTitle = body.asTitle === true;

  let triggerCondition: string | null = null;
  if (!asTitle && kind === "conditional") {
    const t = buildIllustTrigger(body);
    if ("error" in t) return bad(t.error);
    triggerCondition = t.value;
  }

  // 스토리지 접근/외부 호출 전에 설정 여부부터 확인
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

  // 참조 이미지: 업로드(base64) + (선택) 캐릭터 타이틀 이미지
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  const refs = parsed.refs;
  if (body.refTitleImage === true) {
    const t = await query<{ title_image_url: string | null }>("SELECT title_image_url FROM characters WHERE id = ?", [characterId]);
    const tr = await fetchRefImage(t[0]?.title_image_url, req.nextUrl.origin);
    if (tr) refs.unshift(tr);
  }

  let buffer: Buffer;
  try {
    buffer = await generateImage(prompt, refs);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("studio illust generate error:", e);
    // 설정 미등록은 400, 외부 API 오류는 502
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  const ts = Date.now();
  let url: string;
  let illustId: number | undefined;
  if (asTitle) {
    const rows = await query<{ title_image_key: string | null }>(
      "SELECT title_image_key FROM characters WHERE id = ?",
      [characterId]
    );
    const oldKey = rows[0]?.title_image_key;
    const key = `characters/${characterId}/title-ai-${ts}.png`;
    url = await storage.upload(key, buffer, "image/png");
    await execute("UPDATE characters SET title_image_key = ?, title_image_url = ? WHERE id = ?", [
      key,
      url,
      characterId,
    ]);
    if (oldKey) {
      try {
        await storage.remove(oldKey);
      } catch {
        // 무시
      }
    }
  } else {
    const key = `illustrations/${characterId}/ai-${ts}.png`;
    url = await storage.upload(key, buffer, "image/png");
    const result = await execute(
      `INSERT INTO illustrations (character_id, kind, storage_key, url, description, trigger_condition, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [characterId, kind, key, url, description, triggerCondition, 0]
    );
    illustId = result.insertId;
  }
  await invalidateChatContext(characterId);

  // 생성 성공 후 차감
  const cost = (await getPricingSettings()).illustGenCost;
  const balance = await chargeCoins(auth.userId, cost, "illust_gen_spend", {
    refType: "character",
    refId: characterId,
  });
  return NextResponse.json({ url, id: illustId, cost, balance }, { status: 201 });
}
