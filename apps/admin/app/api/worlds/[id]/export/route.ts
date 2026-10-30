import { NextRequest, NextResponse } from "next/server";
import { exportWorld } from "@vchatbot/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 세계관 JSON 다운로드 (공용 사전·기념일 포함) */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const n = Number(id);
  const data = Number.isInteger(n) && n > 0 ? await exportWorld(n) : null;
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="world-${n}.json"`,
    },
  });
}
