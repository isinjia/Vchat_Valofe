import { NextRequest, NextResponse } from "next/server";
import {
  query,
  execute,
  recordLlmUsage,
  invalidateChatContext,
  compactPersonaSource,
  compactPersonaHash,
  summarizeCompactPersona,
  buildCachedPersona,
  COMPACT_SOURCE_LIMIT,
  type CharacterPersona,
} from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/characters/[id]/compact — 브라우저 AI 용 프로필 생성 (관리자, 코인 차감 없음).
 * 저장된 설정 기준으로 짧으면 그대로 구조화 캐싱, 길면 보조 LLM 압축. 스튜디오 쪽과 동일 로직.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await query<CharacterPersona>("SELECT * FROM characters WHERE id = ?", [id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = rows[0];

  const source = compactPersonaSource(row);
  let text: string;
  let method: "cached" | "compressed";
  if (source.length <= COMPACT_SOURCE_LIMIT) {
    text = buildCachedPersona(row);
    method = "cached";
  } else {
    try {
      const worlds = await query<{ name: string }>("SELECT name FROM worlds WHERE id = ?", [row.world_id]);
      const r = await summarizeCompactPersona({
        characterName: row.name,
        worldName: worlds[0]?.name ?? "",
        source,
      });
      text = r.text;
      if (r.usage) await recordLlmUsage(r.providerId, r.accountId, r.usage);
      method = "compressed";
    } catch (err) {
      console.error("admin compact persona generate error:", err);
      return NextResponse.json({ error: `압축 생성 중 오류: ${(err as Error).message}` }, { status: 502 });
    }
  }

  await execute("UPDATE characters SET compact_prompt = ?, compact_prompt_hash = ? WHERE id = ?", [
    text,
    compactPersonaHash(source),
    Number(id),
  ]);
  await invalidateChatContext(Number(id));
  return NextResponse.json({ status: "ready", method });
}
