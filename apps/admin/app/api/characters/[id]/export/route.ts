import { NextRequest, NextResponse } from "next/server";
import { exportCharacter } from "@vchatbot/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 캐릭터 JSON 다운로드 (전용 사전·개인 기념일·관계·일러스트 포함) */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const n = Number(id);
  const data = Number.isInteger(n) && n > 0 ? await exportCharacter(n) : null;
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="character-${n}.json"`,
    },
  });
}
