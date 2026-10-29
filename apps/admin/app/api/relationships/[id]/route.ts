import { NextRequest, NextResponse } from "next/server";
import { execute, invalidateChatContext } from "@vchatbot/core";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await execute("DELETE FROM character_relationships WHERE id = ?", [id]);
  await invalidateChatContext();
  return NextResponse.json({ ok: true });
}
