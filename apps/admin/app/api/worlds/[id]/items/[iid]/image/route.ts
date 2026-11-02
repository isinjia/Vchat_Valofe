import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, imageExtFromMime, type WorldItemRow } from "@vchatbot/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; iid: string }> };

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}
async function worldExists(id: string): Promise<boolean> {
  const rows = await query("SELECT id FROM worlds WHERE id = ?", [Number(id)]);
  return rows.length > 0;
}

const SLOTS = ["icon", "image"] as const;
type Slot = (typeof SLOTS)[number];

/** POST multipart: slot('icon'|'image') + file — 아이템 아이콘/큰 이미지 등록·교체 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, iid } = await params;
  if (!(await worldExists(id))) return bad("세계관을 찾을 수 없습니다.", 404);
  const worldId = Number(id);

  const rows = await query<WorldItemRow>("SELECT * FROM world_items WHERE id = ? AND world_id = ?", [Number(iid), worldId]);
  if (rows.length === 0) return bad("아이템을 찾을 수 없습니다.", 404);
  const item = rows[0];

  const form = await req.formData();
  const slot = String(form.get("slot") ?? "") as Slot;
  if (!SLOTS.includes(slot)) return bad("slot 은 icon 또는 image 여야 합니다.");
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

  const oldKey = slot === "icon" ? item.icon_key : item.image_key;
  const key = `world-items/${worldId}/${item.id}-${slot}-${Date.now()}.${ext}`;
  const url = await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type || "image/png");
  await execute(
    slot === "icon"
      ? "UPDATE world_items SET icon_key = ?, icon_url = ? WHERE id = ?"
      : "UPDATE world_items SET image_key = ?, image_url = ? WHERE id = ?",
    [key, url, item.id]
  );
  if (oldKey && oldKey !== key) {
    try {
      await storage.remove(oldKey);
    } catch {
      // 무시
    }
  }
  return NextResponse.json({ slot, url });
}
