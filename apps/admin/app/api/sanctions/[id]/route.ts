import { NextRequest, NextResponse } from "next/server";
import { revokeSanction } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

/** DELETE — 제재 중도 해제 (이력은 보존) */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!Number.isInteger(Number(id)) || Number(id) < 1) {
    return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });
  }
  await revokeSanction(Number(id));
  return NextResponse.json({ ok: true });
}
