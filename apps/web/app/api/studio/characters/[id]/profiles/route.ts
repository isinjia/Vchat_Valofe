import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, invalidateChatContext, imageExtFromMime } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

const EMOTIONS = ["default", "joy", "sad", "angry", "shy", "surprised", "love", "neutral"];

/** 프로필 이미지 목록 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const rows = await query(
    "SELECT id, emotion, url FROM character_profiles WHERE character_id = ? ORDER BY id",
    [Number(id)]
  );
  return NextResponse.json(rows);
}

/** multipart: file + emotion — 감정별 프로필 이미지 등록/교체 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;

  const form = await req.formData();
  const file = form.get("file");
  const emotion = String(form.get("emotion") ?? "default");
  if (!EMOTIONS.includes(emotion)) return bad("emotion 이 올바르지 않습니다.");
  if (!(file instanceof File)) return bad("file 이 필요합니다.");
  if (!file.type.startsWith("image/")) return bad("이미지 파일만 업로드할 수 있습니다.");
  const ext = imageExtFromMime(file.type);
  if (!ext) return bad("지원하지 않는 이미지 형식입니다 (jpg/png/webp/gif/avif).");

  let storage;
  try {
    storage = await getStorage();
  } catch (e) {
    return bad((e as Error).message);
  }

  const cid = Number(id);
  const old = await query<{ storage_key: string | null }>(
    "SELECT storage_key FROM character_profiles WHERE character_id = ? AND emotion = ?",
    [cid, emotion]
  );
  const key = `profiles/${cid}/${emotion}-${Date.now()}.${ext}`;
  const url = await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type || "image/png");
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
  return NextResponse.json({ emotion, url });
}
