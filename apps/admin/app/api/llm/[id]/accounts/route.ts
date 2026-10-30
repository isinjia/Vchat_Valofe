import { NextRequest, NextResponse } from "next/server";
import { query, execute, currentMonthUtc } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

function maskKey(key: string | null): string | null {
  if (!key) return null;
  return "****" + key.slice(-4);
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<{
    id: number;
    llm_provider_id: number;
    label: string;
    api_key: string | null;
    monthly_token_limit: number | string;
    is_active: number;
    input_tokens: number | string;
    output_tokens: number | string;
    request_count: number | string;
  }>(
    `SELECT a.id, a.llm_provider_id, a.label, a.api_key, a.monthly_token_limit, a.is_active,
            COALESCE(u.input_tokens, 0) AS input_tokens,
            COALESCE(u.output_tokens, 0) AS output_tokens,
            COALESCE(u.request_count, 0) AS request_count
     FROM llm_accounts a
     LEFT JOIN llm_account_usage u ON u.llm_account_id = a.id AND u.month = ?
     WHERE a.llm_provider_id = ?
     ORDER BY a.id`,
    [currentMonthUtc(), id]
  );
  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      api_key: maskKey(r.api_key),
      monthly_token_limit: Number(r.monthly_token_limit),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      request_count: Number(r.request_count),
    }))
  );
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const b = await req.json();
  const limit = Number(b.monthly_token_limit ?? 0);
  if (!b.label) return NextResponse.json({ error: "label 은 필수입니다." }, { status: 400 });
  if (!Number.isInteger(limit) || limit < 0) {
    return NextResponse.json({ error: "monthly_token_limit 는 0 이상의 정수여야 합니다." }, { status: 400 });
  }
  const prov = await query("SELECT id FROM llm_providers WHERE id = ?", [id]);
  if (prov.length === 0) return NextResponse.json({ error: "LLM 을 찾을 수 없습니다." }, { status: 404 });

  const result = await execute(
    `INSERT INTO llm_accounts (llm_provider_id, label, api_key, monthly_token_limit) VALUES (?, ?, ?, ?)`,
    [id, b.label, b.api_key || null, limit]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
