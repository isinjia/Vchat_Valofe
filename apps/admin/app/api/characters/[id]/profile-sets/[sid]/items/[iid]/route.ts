import { NextRequest, NextResponse } from "next/server";
import { query, execute, getStorage } from "@vchatbot/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sid: string; iid: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** 캐릭터 존재 확인 (관리툴: 소유권 검사 없음) */
async function existingCharacter(id: string): Promise<{ world_id: number; advanced_profile: number } | { res: NextResponse }> {
  const rows = await query<{ world_id: number; advanced_profile: number }>(
    "SELECT id, world_id, advanced_profile FROM characters WHERE id = ?",
    [Number(id)]
  );
  if (rows.length === 0) return { res: bad("찾을 수 없습니다.", 404) };
  return rows[0];
}

/**
 * GET: 저장된 이미지 바이트를 그대로 반환 (색 지우개 편집기의 캔버스 로딩용 — 외부 스토리지 CORS 우회)
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id, sid, iid } = await params;
  const own = await existingCharacter(id);
  if ("res" in own) return own.res;

  const rows = await query<{ url: string }>(
    `SELECT i.url
     FROM character_profile_items i
     JOIN character_profile_sets s ON s.id = i.set_id
     WHERE i.id = ? AND i.set_id = ? AND s.character_id = ?`,
    [Number(iid), Number(sid), Number(id)]
  );
  if (rows.length === 0) return bad("항목을 찾을 수 없습니다.", 404);

  // 상대 경로(url)면 같은 오리진 기준으로 절대화
  const abs = /^https?:\/\//i.test(rows[0].url) ? rows[0].url : new URL(rows[0].url, req.nextUrl.origin).toString();
  const res = await fetch(abs, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res || !res.ok) return bad("이미지를 불러올 수 없습니다.", 502);
  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/png",
      "Cache-Control": "no-store",
    },
  });
}

/** DELETE: 세트 안 감정별 이미지 삭제 (+스토리지 제거) */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, sid, iid } = await params;
  const own = await existingCharacter(id);
  if ("res" in own) return own.res;

  const rows = await query<{ id: number; storage_key: string }>(
    `SELECT i.id, i.storage_key
     FROM character_profile_items i
     JOIN character_profile_sets s ON s.id = i.set_id
     WHERE i.id = ? AND i.set_id = ? AND s.character_id = ?`,
    [Number(iid), Number(sid), Number(id)]
  );
  if (rows.length === 0) return bad("항목을 찾을 수 없습니다.", 404);

  await execute("DELETE FROM character_profile_items WHERE id = ?", [rows[0].id]);
  try {
    const storage = await getStorage();
    await storage.remove(rows[0].storage_key);
  } catch {
    // 무시
  }
  return NextResponse.json({ ok: true });
}
