import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, imageExtFromMime } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";
import { PROFILE_EMOTIONS } from "@/lib/profile-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sid: string }> };

/** POST multipart: emotion + file — 얼굴세트의 감정별 이미지 등록/교체 (투명배경 PNG 권장) */
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
  if (sets[0].category !== "face") return bad("감정별 이미지는 얼굴세트에만 등록할 수 있습니다.");
  const setId = sets[0].id;

  const form = await req.formData();
  const emotion = String(form.get("emotion") ?? "default");
  if (!PROFILE_EMOTIONS.includes(emotion)) return bad("emotion 이 올바르지 않습니다.");
  const file = form.get("file");
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

  const old = await query<{ storage_key: string | null }>(
    "SELECT storage_key FROM character_profile_items WHERE set_id = ? AND emotion = ?",
    [setId, emotion]
  );
  const key = `profiles/${cid}/set${setId}-face-${emotion}-${Date.now()}.${ext}`;
  const url = await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type || "image/png");
  await execute(
    `INSERT INTO character_profile_items (set_id, emotion, storage_key, url) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE storage_key = VALUES(storage_key), url = VALUES(url)`,
    [setId, emotion, key, url]
  );
  if (old[0]?.storage_key && old[0].storage_key !== key) {
    try {
      await storage.remove(old[0].storage_key);
    } catch {
      // 무시
    }
  }
  return NextResponse.json({ emotion, url });
}
