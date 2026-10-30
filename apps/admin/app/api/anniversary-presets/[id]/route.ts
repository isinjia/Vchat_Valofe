import { NextRequest, NextResponse } from "next/server";
import { execute, parseAnniversaryInput } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

// 프리셋 수정은 이미 세계관에 복사된 기념일(스냅샷)에는 영향을 주지 않는다
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = parseAnniversaryInput(await req.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { name, month, day, notice_days, duration_days, description } = parsed.value;
  await execute(
    "UPDATE anniversary_presets SET name = ?, month = ?, day = ?, notice_days = ?, duration_days = ?, description = ? WHERE id = ?",
    [name, month, day, notice_days, duration_days, description, id]
  );
  return NextResponse.json({ ok: true });
}

// 삭제 시 세계관 기념일의 preset_id 는 FK 로 NULL 처리(커스텀으로 전환)되므로 채팅 컨텍스트 영향 없음
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await execute("DELETE FROM anniversary_presets WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
