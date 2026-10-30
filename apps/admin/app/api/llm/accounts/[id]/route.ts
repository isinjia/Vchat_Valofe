import { NextRequest, NextResponse } from "next/server";
import { query, execute, type LlmAccountRow } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

/** UI 가 마스킹된 키를 되돌려보내는 사고를 막기 위한 "기존 값 유지" 센티넬 */
const KEEP = "__KEEP__";

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<LlmAccountRow>("SELECT * FROM llm_accounts WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cur = rows[0];

  const b = await req.json();
  const apiKey = b.api_key === undefined || b.api_key === KEEP ? cur.api_key : b.api_key || null;
  const limit = b.monthly_token_limit !== undefined ? Number(b.monthly_token_limit) : Number(cur.monthly_token_limit);
  if (!Number.isInteger(limit) || limit < 0) {
    return NextResponse.json({ error: "monthly_token_limit 는 0 이상의 정수여야 합니다." }, { status: 400 });
  }

  await execute(
    `UPDATE llm_accounts SET label = ?, api_key = ?, monthly_token_limit = ?, is_active = ? WHERE id = ?`,
    [
      b.label ?? cur.label,
      apiKey,
      limit,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : cur.is_active,
      id,
    ]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await execute("DELETE FROM llm_accounts WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
