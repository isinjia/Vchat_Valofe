import { NextRequest, NextResponse } from "next/server";
import { query, execute, type LlmProviderRow } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

/** UI 가 마스킹된 키를 되돌려보내는 사고를 막기 위한 "기존 값 유지" 센티넬 */
const KEEP = "__KEEP__";

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<LlmProviderRow>("SELECT * FROM llm_providers WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cur = rows[0];

  const b = await req.json();
  const provider = b.provider ?? cur.provider;
  const baseUrl = b.base_url !== undefined ? b.base_url || null : cur.base_url;
  const apiKey = b.api_key === undefined || b.api_key === KEEP ? cur.api_key : b.api_key || null;
  const maxTokens = b.max_tokens !== undefined ? Number(b.max_tokens) : cur.max_tokens;

  if (provider !== "anthropic" && provider !== "openai_compatible") {
    return NextResponse.json({ error: "provider 값이 올바르지 않습니다." }, { status: 400 });
  }
  if (provider === "openai_compatible" && !baseUrl) {
    return NextResponse.json({ error: "openai_compatible 는 base_url 이 필요합니다." }, { status: 400 });
  }
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    return NextResponse.json({ error: "max_tokens 는 1 이상의 정수여야 합니다." }, { status: 400 });
  }

  const curRow = cur as unknown as Record<string, unknown>;
  const costIn = b.cost_per_1m_input !== undefined ? Number(b.cost_per_1m_input) : Number(curRow.cost_per_1m_input ?? 0);
  const costOut = b.cost_per_1m_output !== undefined ? Number(b.cost_per_1m_output) : Number(curRow.cost_per_1m_output ?? 0);
  if (!Number.isFinite(costIn) || costIn < 0 || !Number.isFinite(costOut) || costOut < 0) {
    return NextResponse.json({ error: "단가는 0 이상의 숫자여야 합니다." }, { status: 400 });
  }
  const currency =
    b.cost_currency !== undefined
      ? String(b.cost_currency).trim() || "USD"
      : String(curRow.cost_currency ?? "USD");

  await execute(
    `UPDATE llm_providers
     SET name = ?, provider = ?, model = ?, api_key = ?, base_url = ?, max_tokens = ?, is_active = ?,
         cost_per_1m_input = ?, cost_per_1m_output = ?, cost_currency = ?
     WHERE id = ?`,
    [
      b.name ?? cur.name,
      provider,
      b.model ?? cur.model,
      apiKey,
      baseUrl,
      maxTokens,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : cur.is_active,
      costIn,
      costOut,
      currency,
      id,
    ]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await execute("DELETE FROM llm_providers WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
