import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { execute, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedCharacter } from "@/lib/studio";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** POST — 비공개 공유 키 발급 (없으면 생성, 있으면 그대로 반환) */
export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;

  let key = (own.row as { share_key?: string | null }).share_key ?? null;
  if (!key) {
    key = randomBytes(12).toString("base64url");
    await execute("UPDATE characters SET share_key = ? WHERE id = ? AND owner_user_id = ?", [
      key,
      Number(id),
      auth.userId,
    ]);
    await invalidateChatContext(Number(id));
  }
  return NextResponse.json({ key });
}
