import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage, imageExtFromMime } from "@vchatbot/core";
import { requireUser, ownedWorld, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** 지역 사전 항목 검증: 이 세계관의 location 항목이어야 한다. null 허용(세계관 공통) */
async function resolveDictEntry(worldId: number, raw: unknown): Promise<{ id: number | null } | { error: string }> {
  if (raw == null || raw === "" || raw === "null") return { id: null };
  const entryId = Number(raw);
  if (!Number.isInteger(entryId) || entryId <= 0) return { error: "dict_entry_id 가 올바르지 않습니다." };
  const rows = await query("SELECT id FROM world_dictionary WHERE id = ? AND world_id = ? AND category = 'location'", [
    entryId,
    worldId,
  ]);
  if (rows.length === 0) return { error: "이 세계관의 지역사전 항목이 아닙니다." };
  return { id: entryId };
}

/** GET: 세계관 일러스트 목록 (지역명 포함) */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  const rows = await query(
    `SELECT wi.*, d.title AS place_title
     FROM world_illustrations wi LEFT JOIN world_dictionary d ON d.id = wi.dict_entry_id
     WHERE wi.world_id = ? ORDER BY wi.dict_entry_id IS NULL DESC, wi.dict_entry_id, wi.sort_order, wi.id`,
    [Number(id)]
  );
  return NextResponse.json(rows);
}

/**
 * POST multipart/form-data 직접 업로드 (과금 없음)
 *   file, dict_entry_id?(location 사전 항목, 비우면 세계관 공통), description?, sort_order?
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  const worldId = Number(id);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("file 이 필요합니다.");
  if (!file.type.startsWith("image/")) return bad("이미지 파일만 업로드할 수 있습니다.");
  const entry = await resolveDictEntry(worldId, form.get("dict_entry_id"));
  if ("error" in entry) return bad(entry.error);
  const description = (form.get("description") as string) || null;
  const sortOrder = Number(form.get("sort_order") || 0) || 0;

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
  const key = `world-illustrations/${worldId}/${Date.now()}.${ext}`;
  const url = await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type || "image/png");

  const result = await execute(
    `INSERT INTO world_illustrations (world_id, dict_entry_id, storage_key, url, description, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [worldId, entry.id, key, url, description, sortOrder]
  );
  return NextResponse.json({ id: result.insertId, url }, { status: 201 });
}
