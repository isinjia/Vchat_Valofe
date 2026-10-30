import { NextRequest, NextResponse } from "next/server";
import { query, execute, type ImageProviderRow } from "@vchatbot/core";

const PROVIDERS = ["openai", "gemini", "openai_compatible"];

/** api_key 마스킹: 값이 있으면 "****" + 뒤 4자리 */
function maskKey(key: string | null): string | null {
  if (!key) return null;
  return "****" + key.slice(-4);
}

export async function GET() {
  const rows = await query<ImageProviderRow>("SELECT * FROM image_providers ORDER BY is_default DESC, id DESC");
  return NextResponse.json(
    rows.map((r) => ({ ...r, api_key: maskKey(r.api_key), cost_per_image: Number(r.cost_per_image) }))
  );
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const name = String(b.name ?? "").trim();
  const model = String(b.model ?? "").trim();
  if (!name || !model) {
    return NextResponse.json({ error: "name, model 은 필수입니다." }, { status: 400 });
  }
  if (!PROVIDERS.includes(b.provider)) {
    return NextResponse.json({ error: "provider 값이 올바르지 않습니다." }, { status: 400 });
  }
  const baseUrl = String(b.base_url ?? "").trim();
  if (b.provider === "openai_compatible" && !baseUrl) {
    return NextResponse.json({ error: "openai_compatible 는 base_url 이 필요합니다." }, { status: 400 });
  }
  const cost = Number(b.cost_per_image ?? 0);
  if (!Number.isFinite(cost) || cost < 0) {
    return NextResponse.json({ error: "장당 비용은 0 이상의 숫자여야 합니다." }, { status: 400 });
  }
  const size = String(b.size ?? "").trim() || "1024x1536";
  const currency = String(b.cost_currency ?? "").trim() || "USD";
  const cnt = await query<{ c: number | string }>("SELECT COUNT(*) AS c FROM image_providers");
  const isDefault = Number(cnt[0]?.c ?? 0) === 0 ? 1 : 0;
  const result = await execute(
    `INSERT INTO image_providers (name, provider, model, api_key, base_url, size, cost_per_image, cost_currency, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, b.provider, model, b.api_key || null, baseUrl || null, size, cost, currency, isDefault]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
