import { NextRequest, NextResponse } from "next/server";
import { query, execute, type LlmProviderRow } from "@vchatbot/core";

/** api_key 마스킹: 값이 있으면 "****" + 뒤 4자리 */
function maskKey(key: string | null): string | null {
  if (!key) return null;
  return "****" + key.slice(-4);
}

export async function GET() {
  const rows = await query<LlmProviderRow>("SELECT * FROM llm_providers ORDER BY id DESC");
  return NextResponse.json(rows.map((r) => ({ ...r, api_key: maskKey(r.api_key) })));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, provider, model, api_key, base_url, max_tokens = 4096, is_active = 1 } = body;
  if (!name || !model) {
    return NextResponse.json({ error: "name, model 은 필수입니다." }, { status: 400 });
  }
  if (provider !== "anthropic" && provider !== "openai_compatible") {
    return NextResponse.json({ error: "provider 값이 올바르지 않습니다." }, { status: 400 });
  }
  if (provider === "openai_compatible" && !base_url) {
    return NextResponse.json({ error: "openai_compatible 는 base_url 이 필요합니다." }, { status: 400 });
  }
  const mt = Number(max_tokens);
  if (!Number.isInteger(mt) || mt < 1) {
    return NextResponse.json({ error: "max_tokens 는 1 이상의 정수여야 합니다." }, { status: 400 });
  }
  const result = await execute(
    `INSERT INTO llm_providers (name, provider, model, api_key, base_url, max_tokens, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, provider, model, api_key || null, base_url || null, mt, is_active ? 1 : 0]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
