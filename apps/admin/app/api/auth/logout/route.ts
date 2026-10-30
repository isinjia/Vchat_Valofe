import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearAdminSessionCookie } from "@/lib/admin-session";

export const runtime = "nodejs";

export async function POST() {
  clearAdminSessionCookie(await cookies());
  return NextResponse.json({ ok: true });
}
