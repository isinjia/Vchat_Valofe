import { NextRequest, NextResponse } from "next/server";
import { query, getPool } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

/** PUT { assignments: [{ llm_provider_id, weight }] } — 등급의 할당 전체 교체 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const tiers = await query("SELECT id FROM chat_tiers WHERE id = ?", [id]);
  if (tiers.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { assignments } = await req.json();
  if (!Array.isArray(assignments)) {
    return NextResponse.json({ error: "assignments 배열이 필요합니다." }, { status: 400 });
  }
  const seen = new Set<number>();
  const clean: { llm: number; weight: number }[] = [];
  for (const a of assignments) {
    const llm = Number(a?.llm_provider_id);
    const weight = Number(a?.weight);
    if (!Number.isInteger(llm) || llm < 1) {
      return NextResponse.json({ error: "llm_provider_id 가 올바르지 않습니다." }, { status: 400 });
    }
    if (!Number.isInteger(weight) || weight < 1) {
      return NextResponse.json({ error: "weight 는 1 이상의 정수여야 합니다." }, { status: 400 });
    }
    if (seen.has(llm)) {
      return NextResponse.json({ error: "같은 LLM 을 중복 할당할 수 없습니다." }, { status: 400 });
    }
    seen.add(llm);
    clean.push({ llm, weight });
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM tier_llm_assignments WHERE tier_id = ?", [id]);
    for (const a of clean) {
      await conn.query(
        "INSERT INTO tier_llm_assignments (tier_id, llm_provider_id, weight) VALUES (?, ?, ?)",
        [id, a.llm, a.weight]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    return NextResponse.json({ error: `저장 실패: ${(e as Error).message}` }, { status: 400 });
  } finally {
    conn.release();
  }
  return NextResponse.json({ ok: true });
}
