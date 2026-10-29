import { NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { requireUser } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 기념일 프리셋 전체 목록 (읽기 전용, 로그인 필수) */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const rows = await query("SELECT * FROM anniversary_presets ORDER BY month, day, id");
  return NextResponse.json(rows);
}
