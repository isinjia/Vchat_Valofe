import { NextRequest, NextResponse } from "next/server";
import { query, getPool, type ImageProviderRow } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

const PROVIDERS = ["openai", "gemini", "openai_compatible"];
const KEEP = "__KEEP__";

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<ImageProviderRow>("SELECT * FROM image_providers WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cur = rows[0];
  const b = await req.json();

  const provider = b.provider ?? cur.provider;
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "provider 값이 올바르지 않습니다." }, { status: 400 });
  }
  const baseUrl = b.base_url !== undefined ? String(b.base_url ?? "").trim() || null : cur.base_url;
  if (provider === "openai_compatible" && !baseUrl) {
    return NextResponse.json({ error: "openai_compatible 는 base_url 이 필요합니다." }, { status: 400 });
  }
  // "__KEEP__" 또는 마스킹 값("****...")이면 기존 키 유지
  const keepKey =
    b.api_key === undefined || b.api_key === KEEP || (typeof b.api_key === "string" && b.api_key.startsWith("****"));
  const apiKey = keepKey ? cur.api_key : b.api_key || null;
  const cost = b.cost_per_image !== undefined ? Number(b.cost_per_image) : Number(cur.cost_per_image);
  if (!Number.isFinite(cost) || cost < 0) {
    return NextResponse.json({ error: "장당 비용은 0 이상의 숫자여야 합니다." }, { status: 400 });
  }
  const name = b.name !== undefined ? String(b.name).trim() : cur.name;
  const model = b.model !== undefined ? String(b.model).trim() : cur.model;
  if (!name || !model) {
    return NextResponse.json({ error: "name, model 은 필수입니다." }, { status: 400 });
  }
  const size = b.size !== undefined ? String(b.size).trim() || cur.size : cur.size;
  const currency = b.cost_currency !== undefined ? String(b.cost_currency).trim() || "USD" : cur.cost_currency;
  const isActive = b.is_active !== undefined ? (b.is_active ? 1 : 0) : cur.is_active;
  const makeDefault = b.is_default !== undefined ? !!b.is_default : false;

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    if (makeDefault) await conn.execute("UPDATE image_providers SET is_default = 0 WHERE id <> ?", [id]);
    await conn.execute(
      `UPDATE image_providers
       SET name = ?, provider = ?, model = ?, api_key = ?, base_url = ?, size = ?,
           cost_per_image = ?, cost_currency = ?, is_active = ?, is_default = ?
       WHERE id = ?`,
      [name, provider, model, apiKey, baseUrl, size, cost, currency, isActive, makeDefault ? 1 : cur.is_default, id]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<ImageProviderRow>("SELECT * FROM image_providers WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ ok: true });
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM image_providers WHERE id = ?", [id]);
    if (rows[0].is_default) {
      await conn.execute("UPDATE image_providers SET is_default = 1 ORDER BY id LIMIT 1");
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return NextResponse.json({ ok: true });
}
