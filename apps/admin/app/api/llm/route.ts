import { NextRequest, NextResponse } from "next/server";
import { query, execute, type LlmProviderRow } from "@vchatbot/core";

/** api_key 마스킹: 값이 있으면 "****" + 뒤 4자리 */
function maskKey(key: string | null): string | null {
  if (!key) return null;
  return "****" + key.slice(-4);
}

export async function GET() {
  const rows = await query<LlmProviderRow & { account_count: number | string }>(
    `SELECT p.*, (SELECT COUNT(*) FROM llm_accounts a WHERE a.llm_provider_id = p.id) AS account_count
     FROM llm_providers p ORDER BY p.id DESC`
  );
  // 이 LLM 을 사용하는 AI 레벨 목록
  const levelRows = await query<{ llm_provider_id: number; level: number; name: string; is_active: number }>(
    `SELECT a.llm_provider_id, l.level, l.name, l.is_active
     FROM ai_level_llm_assignments a JOIN ai_levels l ON l.id = a.ai_level_id
     ORDER BY l.level`
  );
  const levelsByProvider = new Map<number, { level: number; name: string; is_active: number }[]>();
  for (const lr of levelRows) {
    const arr = levelsByProvider.get(lr.llm_provider_id) ?? [];
    arr.push({ level: lr.level, name: lr.name, is_active: lr.is_active });
    levelsByProvider.set(lr.llm_provider_id, arr);
  }
  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      api_key: maskKey(r.api_key),
      account_count: Number(r.account_count),
      ai_levels: levelsByProvider.get(r.id) ?? [],
    }))
  );
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
  const costIn = Number(body.cost_per_1m_input ?? 0);
  const costOut = Number(body.cost_per_1m_output ?? 0);
  if (!Number.isFinite(costIn) || costIn < 0 || !Number.isFinite(costOut) || costOut < 0) {
    return NextResponse.json({ error: "단가는 0 이상의 숫자여야 합니다." }, { status: 400 });
  }
  const currency = String(body.cost_currency ?? "").trim() || "USD";
  const result = await execute(
    `INSERT INTO llm_providers (name, provider, model, api_key, base_url, max_tokens, is_active,
       cost_per_1m_input, cost_per_1m_output, cost_currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, provider, model, api_key || null, base_url || null, mt, is_active ? 1 : 0, costIn, costOut, currency]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
