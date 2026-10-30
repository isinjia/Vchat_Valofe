import { NextResponse } from "next/server";
import { query } from "@vchatbot/core";

export const dynamic = "force-dynamic";

interface UsageRow {
  id: number;
  name: string;
  model: string;
  input_tokens: number | string;
  output_tokens: number | string;
  request_count: number | string;
  cost_per_1m_input: number | string;
  cost_per_1m_output: number | string;
  cost_currency: string;
}

/** 이번 달(UTC) 예상 AI 비용 */
export async function GET() {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)

  const rows = await query<UsageRow>(
    `SELECT p.id, p.name, p.model, u.input_tokens, u.output_tokens, u.request_count,
            p.cost_per_1m_input, p.cost_per_1m_output, p.cost_currency
     FROM llm_provider_usage u JOIN llm_providers p ON p.id = u.llm_provider_id
     WHERE u.month = ? ORDER BY p.id`,
    [month]
  );

  const totals: Record<string, number> = {};
  const add = (cur: string, n: number) => {
    totals[cur] = (totals[cur] ?? 0) + n;
  };

  const providers = rows.map((r) => {
    const inputTokens = Number(r.input_tokens);
    const outputTokens = Number(r.output_tokens);
    const cost =
      (inputTokens * Number(r.cost_per_1m_input) + outputTokens * Number(r.cost_per_1m_output)) / 1_000_000;
    add(r.cost_currency, cost);
    return {
      id: r.id,
      name: r.name,
      model: r.model,
      inputTokens,
      outputTokens,
      requests: Number(r.request_count),
      cost,
      currency: r.cost_currency,
    };
  });

  // 이미지: 이번 달 illust_gen_spend 건수 × 기본 프로바이더 장당 비용
  const cnt = await query<{ c: number | string }>(
    `SELECT COUNT(*) AS c FROM coin_transactions
     WHERE type = 'illust_gen_spend' AND created_at >= ?`,
    [`${month}-01 00:00:00`]
  );
  const imageCount = Number(cnt[0]?.c ?? 0);
  const def = await query<{ cost_per_image: number | string; cost_currency: string }>(
    "SELECT cost_per_image, cost_currency FROM image_providers WHERE is_default = 1 LIMIT 1"
  );
  const imageCost = def[0] ? imageCount * Number(def[0].cost_per_image) : 0;
  const imageCurrency = def[0]?.cost_currency ?? "USD";
  if (def[0]) add(imageCurrency, imageCost);

  return NextResponse.json({ month, providers, imageCount, imageCost, imageCurrency, totals });
}
