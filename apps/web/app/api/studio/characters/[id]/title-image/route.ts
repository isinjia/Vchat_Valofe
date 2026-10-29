import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, invalidateChatContext, imageExtFromMime } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** multipart/form-data 업로드 — 캐릭터 타이틀 이미지 (file) */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("file 이 필요합니다.");
  if (!file.type.startsWith("image/")) return bad("이미지 파일만 업로드할 수 있습니다.");

  let storage;
  try {
    storage = await getStorage();
  } catch (e) {
    return bad((e as Error).message);
  }

  const rows = await query<{ title_image_key: string | null }>(
    "SELECT title_image_key FROM characters WHERE id = ?",
    [Number(id)]
  );
  const oldKey = rows[0]?.title_image_key;

  const ext = imageExtFromMime(file.type);
  if (!ext) {
    return NextResponse.json({ error: "지원하지 않는 이미지 형식입니다 (jpg/png/webp/gif/avif)." }, { status: 400 });
  }
  const key = `characters/${Number(id)}/title-${Date.now()}.${ext}`;
  const url = await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type || "image/png");

  await execute("UPDATE characters SET title_image_key = ?, title_image_url = ? WHERE id = ?", [key, url, Number(id)]);
  if (oldKey) {
    try {
      await storage.remove(oldKey);
    } catch {
      // 무시
    }
  }
  await invalidateChatContext(Number(id));
  return NextResponse.json({ url });
}
