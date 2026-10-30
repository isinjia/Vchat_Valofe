import { NextRequest, NextResponse } from "next/server";
import {
  query,
  execute,
  getStorage,
  invalidateChatContext,
  generateImage,
  getImageGenSettings,
} from "@vchatbot/core";
import { parseRefImages, fetchRefImage } from "@/lib/image-refs";
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

const EMOTIONS = ["default", "joy", "sad", "angry", "shy", "surprised", "love", "neutral"];

/**
 * POST /api/characters/:id/profiles/generate
 *   { emotion, prompt, useTitleRef?, useDefaultProfileRef?, refImages? }
 * AI 로 프로필 이미지를 생성해 해당 감정 슬롯에 저장(UPSERT). 생성·저장 성공 후에만 코인 차감.
 * 참조 순서: 타이틀 이미지 → 기본 프로필 → 업로드(base64)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const cid = Number(id);
  if (!Number.isInteger(cid) || cid <= 0) return bad("id 가 올바르지 않습니다.");
  const exists = await query("SELECT id FROM characters WHERE id = ?", [cid]);
  if (exists.length === 0) return bad("찾을 수 없습니다.", 404);

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");
  const emotion = typeof body.emotion === "string" ? body.emotion : "";
  if (!EMOTIONS.includes(emotion)) return bad("emotion 이 올바르지 않습니다.");

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

  // 참조 수집: 업로드(base64) 뒤에 타이틀/기본 프로필을 앞쪽으로 끼워 넣는다
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  const refs = parsed.refs;
  const front: NonNullable<Awaited<ReturnType<typeof fetchRefImage>>>[] = [];
  if (body.useTitleRef === true) {
    const t = await query<{ title_image_url: string | null }>("SELECT title_image_url FROM characters WHERE id = ?", [cid]);
    const r = await fetchRefImage(t[0]?.title_image_url, req.nextUrl.origin);
    if (r) front.push(r);
  }
  if (body.useDefaultProfileRef === true && emotion !== "default") {
    const d = await query<{ url: string | null }>(
      "SELECT url FROM character_profiles WHERE character_id = ? AND emotion = 'default'",
      [cid]
    );
    const r = await fetchRefImage(d[0]?.url, req.nextUrl.origin);
    if (r) front.push(r);
  }
  refs.unshift(...front);

  let buffer: Buffer;
  try {
    buffer = await generateImage(prompt, refs);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("admin profile generate error:", e);
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  const old = await query<{ storage_key: string | null }>(
    "SELECT storage_key FROM character_profiles WHERE character_id = ? AND emotion = ?",
    [cid, emotion]
  );
  const key = `profiles/${cid}/${emotion}-ai-${Date.now()}.png`;
  const url = await storage.upload(key, buffer, "image/png");
  await execute(
    `INSERT INTO character_profiles (character_id, emotion, storage_key, url) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE storage_key = VALUES(storage_key), url = VALUES(url)`,
    [cid, emotion, key, url]
  );
  if (old[0]?.storage_key && old[0].storage_key !== key) {
    try {
      await storage.remove(old[0].storage_key);
    } catch {
      // 무시
    }
  }
  await invalidateChatContext(cid);

  return NextResponse.json({ emotion, url }, { status: 201 });
}
