import { NextRequest, NextResponse } from "next/server";
import { env, execute } from "@vchatbot/core";

export const runtime = "nodejs";

/** 요청 본문 발췌에서 민감 값 마스킹 */
function maskSecrets(s: string): string {
  return s.replace(/("(?:api_key|apiKey|password|secretAccessKey)"\s*:\s*")[^"]*(")/g, "$1****$2");
}

/**
 * POST (내부 전용) — 미들웨어가 전달하는 관리자 감사 로그.
 * x-internal-key 가 SESSION_SECRET 과 일치해야 한다.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get("x-internal-key") !== env("SESSION_SECRET", "dev-secret-change-me")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const uid = Number(b?.uid);
  const method = String(b?.method ?? "").slice(0, 8);
  const path = String(b?.path ?? "").slice(0, 512);
  if (!Number.isInteger(uid) || uid < 1 || !method || !path) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const detail = typeof b?.detail === "string" && b.detail ? maskSecrets(b.detail).slice(0, 2000) : null;
  try {
    await execute(
      "INSERT INTO admin_logs (admin_user_id, method, path, detail) VALUES (?, ?, ?, ?)",
      [uid, method, path, detail]
    );
  } catch (e) {
    console.error("admin log insert error:", e);
  }
  return NextResponse.json({ ok: true });
}
