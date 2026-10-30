import { NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { requireUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

/** GET: 유저 트랙 등급 목록 (일러스트 "유저 등급 이상" 조건 select 용) */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const rows = await query(
    "SELECT id, name, tier_rank FROM chat_tiers WHERE track = 'user' ORDER BY tier_rank"
  );
  return NextResponse.json(rows);
}
