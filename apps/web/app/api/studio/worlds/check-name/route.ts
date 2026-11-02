import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { requireUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

/** GET: 세계관 이름 사용 가능 여부 (전체 세계관 대상) — ?name=[&excludeId=] */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const sp = req.nextUrl.searchParams;
  const name = (sp.get("name") ?? "").trim();
  const excludeId = Number(sp.get("excludeId") ?? 0) || 0;
  if (!name) return NextResponse.json({ available: true });
  const rows = await query(
    "SELECT id FROM worlds WHERE name = ? AND id <> ? LIMIT 1",
    [name, excludeId]
  );
  return NextResponse.json({ available: rows.length === 0 });
}
