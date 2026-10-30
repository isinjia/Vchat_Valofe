import { NextRequest, NextResponse } from "next/server";
import { exportWorld } from "@vchatbot/core";
import { requireUser, ownedWorld } from "@/lib/studio";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 내 세계관 JSON 다운로드 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const own = await ownedWorld(id, auth.userId);
  if ("res" in own) return own.res;
  const data = await exportWorld(Number(id));
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="world-${Number(id)}.json"`,
    },
  });
}
