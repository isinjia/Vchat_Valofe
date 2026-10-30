import { buildIllustTrigger, validateTriggerPlace } from "@/lib/illust-trigger";
import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, invalidateChatContext, imageExtFromMime } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const rows = await query(
    "SELECT * FROM illustrations WHERE character_id = ? ORDER BY kind, sort_order, id",
    [Number(id)]
  );
  return NextResponse.json(rows);
}

/**
 * multipart/form-data 직접 업로드 (과금 없음)
 *   file, kind('basic'|'conditional'), description, keywords(쉼표 구분), sort_order
 */
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
  const kind = form.get("kind") === "conditional" ? "conditional" : "basic";
  const description = (form.get("description") as string) || null;
  const sortOrder = Number(form.get("sort_order") || 0) || 0;

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
    if ("error" in t) return bad(t.error);
    triggerCondition = t.value;
    const placeErr = await validateTriggerPlace(triggerCondition, Number(own.row.world_id));
    if (placeErr) return bad(placeErr);
  }

  let storage;
  try {
    storage = await getStorage();
  } catch (e) {
    return bad((e as Error).message);
  }

  const ext = imageExtFromMime(file.type);
  if (!ext) {
    return NextResponse.json({ error: "지원하지 않는 이미지 형식입니다 (jpg/png/webp/gif/avif)." }, { status: 400 });
  }
  const key = `illustrations/${Number(id)}/${Date.now()}.${ext}`;
  const url = await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type || "image/png");

  const result = await execute(
    `INSERT INTO illustrations (character_id, kind, storage_key, url, description, trigger_condition, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [Number(id), kind, key, url, description, triggerCondition, sortOrder]
  );
  await invalidateChatContext(Number(id));
  return NextResponse.json({ id: result.insertId, url }, { status: 201 });
}
