import { buildIllustTrigger } from "@/lib/illust-trigger";
import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, invalidateChatContext, generateImage, getImageGenSettings } from "@vchatbot/core";
import { parseRefImages, fetchRefImage } from "@/lib/image-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * POST /api/characters/:id/illustrations/generate
 *   { prompt, kind: 'basic'|'conditional', keywords?, description?, asTitle? }
 * 운영자 도구: 로그인/과금 없이 AI 일러스트(또는 타이틀 이미지) 생성.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const characterId = Number(id);
  if (!Number.isInteger(characterId) || characterId <= 0) return bad("id 가 올바르지 않습니다.");
  const exists = await query("SELECT id FROM characters WHERE id = ?", [characterId]);
  if (exists.length === 0) return bad("찾을 수 없습니다.", 404);

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
    console.error("admin illust generate error:", e);
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
  return NextResponse.json({ url, id: illustId }, { status: 201 });
}
