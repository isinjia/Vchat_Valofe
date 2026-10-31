import { buildIllustTrigger, validateTriggerPlace } from "@/lib/illust-trigger";
import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, invalidateChatContext, imageExtFromMime, videoExtFromMime } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query(
    "SELECT * FROM illustrations WHERE character_id = ? ORDER BY kind, sort_order, id",
    [id]
  );
  return NextResponse.json(rows);
}

/**
 * multipart/form-data 업로드
 *   file: 이미지 또는 영상(mp4/webm) 파일
 *   kind: 'basic' | 'conditional'
 *   description: 설명 (선택)
 *   keywords: conditional 일 때 쉼표 구분 트리거 키워드
 *   sort_order: 정렬 (선택)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file 이 필요합니다." }, { status: 400 });
  }
  const isVideo = file.type.startsWith("video/");
  if (!file.type.startsWith("image/") && !isVideo) {
    return NextResponse.json({ error: "이미지 또는 영상 파일만 업로드할 수 있습니다." }, { status: 400 });
  }
  const kind = form.get("kind") === "conditional" ? "conditional" : "basic";
  const description = (form.get("description") as string) || null;
  const sortOrder = Number(form.get("sort_order") || 0);

  let triggerCondition: string | null = null;
  if (kind === "conditional") {
    const t = buildIllustTrigger({
      keywords: form.get("keywords"),
      requireEventId: form.get("requireEventId"),
      requireTierId: form.get("requireTierId"),
      requireRelationship: form.get("requireRelationship"),
      minAffinity: form.get("minAffinity"),
      requirePlaceId: form.get("requirePlaceId"),
    });
    if ("error" in t) return NextResponse.json({ error: t.error }, { status: 400 });
    triggerCondition = t.value;
    const w = await query<{ world_id: number }>("SELECT world_id FROM characters WHERE id = ?", [id]);
    const placeErr = await validateTriggerPlace(triggerCondition, Number(w[0]?.world_id));
    if (placeErr) return NextResponse.json({ error: placeErr }, { status: 400 });
  }

  let storage;
  try {
    storage = await getStorage();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const ext = isVideo ? videoExtFromMime(file.type) : imageExtFromMime(file.type);
  if (!ext) {
    return NextResponse.json(
      { error: isVideo ? "지원하지 않는 영상 형식입니다 (mp4/webm)." : "지원하지 않는 이미지 형식입니다 (jpg/png/webp/gif/avif)." },
      { status: 400 }
    );
  }
  const key = `illustrations/${id}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const url = await storage.upload(key, buffer, file.type || "image/png");

  const result = await execute(
    `INSERT INTO illustrations (character_id, kind, media_type, storage_key, url, description, trigger_condition, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, kind, isVideo ? "video" : "image", key, url, description, triggerCondition, sortOrder]
  );
  await invalidateChatContext(Number(id));
  return NextResponse.json({ id: result.insertId, url }, { status: 201 });
}
