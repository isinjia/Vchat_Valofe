import { NextRequest, NextResponse } from "next/server";
import { importWorld } from "@vchatbot/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 사전 임베딩이 많으면 오래 걸린다
export const maxDuration = 300;

/** 세계관 JSON 가져오기 → 새 세계관 생성 (비공개, 운영 소유) */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json(await importWorld(body, null), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
