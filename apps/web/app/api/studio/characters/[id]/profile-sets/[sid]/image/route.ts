import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, imageExtFromMime, getUploadLimitsForUser } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sid: string }> };

/**
 * POST multipart: file — 배경/효과 세트의 단일 이미지 등록/교체.
 * 효과는 Animated GIF/APNG(png)/WebP 애니메이션도 그대로 재생된다.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, sid } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const cid = Number(id);

  const sets = await query<{ id: number; category: string; storage_key: string | null }>(
    "SELECT id, category, storage_key FROM character_profile_sets WHERE id = ? AND character_id = ?",
    [Number(sid), cid]
  );
  if (sets.length === 0) return bad("세트를 찾을 수 없습니다.", 404);
  const set = sets[0];
  if (set.category === "face") return bad("얼굴세트는 감정별 이미지(items)로 등록하세요.");

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("file 이 필요합니다.");
  if (!file.type.startsWith("image/")) return bad("이미지 파일만 업로드할 수 있습니다.");
  // 효과는 말풍선마다 반복 렌더되므로 용량 제한 (애니메이션 GIF/APNG 포함, 쿼터 설정 + 크리에이터 등급별)
  if (set.category === "effect") {
    const { effectMaxMb } = await getUploadLimitsForUser(auth.userId);
    if (file.size > effectMaxMb * 1024 * 1024) return bad(`효과 이미지는 ${effectMaxMb}MB 이하여야 합니다.`);
  }
  const ext = imageExtFromMime(file.type);
  if (!ext) return bad("지원하지 않는 이미지 형식입니다 (jpg/png/webp/gif/avif).");

  let storage;
  try {
    storage = await getStorage();
  } catch (e) {
    return bad((e as Error).message);
  }

  const key = `profiles/${cid}/set${set.id}-${set.category}-${Date.now()}.${ext}`;
  const url = await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type || "image/png");
  await execute("UPDATE character_profile_sets SET storage_key = ?, url = ? WHERE id = ?", [key, url, set.id]);
  if (set.storage_key && set.storage_key !== key) {
    try {
      await storage.remove(set.storage_key);
    } catch {
      // 무시
    }
  }
  return NextResponse.json({ url });
}
