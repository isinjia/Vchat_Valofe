import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, invalidateChatContext, imageExtFromMime } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

/**
 * multipart/form-data 업로드 — 타이틀 이미지 (세로 3:4)
 *   file: 이미지 파일
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file 이 필요합니다." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "이미지 파일만 업로드할 수 있습니다." }, { status: 400 });
  }

  let storage;
  try {
    storage = await getStorage();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const rows = await query<{ title_image_key: string | null }>(
    "SELECT title_image_key FROM characters WHERE id = ?",
    [id]
  );
  const oldKey = rows[0]?.title_image_key;

  const ext = imageExtFromMime(file.type);
  if (!ext) {
    return NextResponse.json({ error: "지원하지 않는 이미지 형식입니다 (jpg/png/webp/gif/avif)." }, { status: 400 });
  }
  const key = `characters/${id}/title-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const url = await storage.upload(key, buffer, file.type || "image/png");

  await execute("UPDATE characters SET title_image_key = ?, title_image_url = ? WHERE id = ?", [
    key,
    url,
    id,
  ]);

  // 기존 이미지는 업로드 성공 후 정리 (실패해도 무시)
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
