import { NextRequest, NextResponse } from "next/server";
import { query, execute, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ rid: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { rid } = await params;
  const rows = await query<{ character_id: number }>(
    "SELECT character_id FROM character_relationships WHERE id = ?",
    [Number(rid)]
  );
  if (rows.length === 0) return bad("찾을 수 없습니다.", 404);
  // 관계의 캐릭터가 내 소유인지 검증
  const own = await ownedCharacter(rows[0].character_id, auth.userId);
  if ("res" in own) return own.res;
  await execute("DELETE FROM character_relationships WHERE id = ?", [Number(rid)]);
  await invalidateChatContext(rows[0].character_id);
  return NextResponse.json({ ok: true });
}
