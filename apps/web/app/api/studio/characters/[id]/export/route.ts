import { NextRequest, NextResponse } from "next/server";
import { exportCharacter } from "@vchatbot/core";
import { requireUser, ownedCharacter } from "@/lib/studio";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 내 캐릭터 JSON 다운로드 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const data = await exportCharacter(Number(id));
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="character-${Number(id)}.json"`,
    },
  });
}
