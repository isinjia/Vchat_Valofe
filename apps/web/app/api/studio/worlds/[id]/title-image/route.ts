import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage } from "@vchatbot/core";
import { requireUser, ownedWorld, bad } from "@/lib/studio";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** multipart/form-data 업로드 — 세계관 타이틀 이미지 (file) */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
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
    "SELECT title_image_key FROM worlds WHERE id = ?",
    [Number(id)]
  );
  const oldKey = rows[0]?.title_image_key;

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const key = `worlds/${Number(id)}/title-${Date.now()}.${ext}`;
  const url = await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type || "image/png");

  await execute("UPDATE worlds SET title_image_key = ?, title_image_url = ? WHERE id = ?", [key, url, Number(id)]);
  if (oldKey) {
    try {
      await storage.remove(oldKey);
    } catch {
      // 무시
    }
  }
  return NextResponse.json({ url });
}
