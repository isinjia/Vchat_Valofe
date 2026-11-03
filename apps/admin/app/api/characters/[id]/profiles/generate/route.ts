import { NextRequest, NextResponse } from "next/server";
import { query, generateImage, isImageGenConfigured } from "@vchatbot/core";
import { parseRefImages, fetchRefImage, collectAssetRefs, withRefNotes, MAX_REFS } from "@/lib/image-refs";
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string }> };

const EMOTIONS = ["default", "joy", "sad", "angry", "shy", "surprised", "love", "neutral"];

/**
 * POST /api/characters/:id/profiles/generate
 *   { emotion, prompt, useTitleRef?, useDefaultProfileRef?, refImages? }
 * AI 로 프로필 이미지를 생성해 base64 로 반환 (저장 안 함 — 클라이언트에서 프리뷰/크롭 후 기존 업로드 라우트로 저장).
 * 참조 순서: 타이틀 이미지 → 기본 프로필 → 업로드(base64)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const cid = Number(id);
  if (!Number.isInteger(cid) || cid <= 0) return bad("id 가 올바르지 않습니다.");
  const exists = await query<{ world_id: number }>("SELECT id, world_id FROM characters WHERE id = ?", [cid]);
  if (exists.length === 0) return bad("찾을 수 없습니다.", 404);

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");
  const emotion = typeof body.emotion === "string" ? body.emotion : "";
  if (!EMOTIONS.includes(emotion)) return bad("emotion 이 올바르지 않습니다.");

  if (!(await isImageGenConfigured())) {
    return bad("이미지 생성이 설정되지 않았습니다. 관리자 > LLM 관리 > 이미지 생성 AI 에서 등록하세요.");
  }

  // 참조 수집: 업로드(base64) 뒤에 타이틀/기본 프로필을 앞쪽으로 끼워 넣는다
  const parsed = parseRefImages(body.refImages);
  if ("error" in parsed) return bad(parsed.error);
  const refs = parsed.refs;
  const front: NonNullable<Awaited<ReturnType<typeof fetchRefImage>>>[] = [];
  if (body.useTitleRef === true) {
    const t = await query<{ title_image_url: string | null }>("SELECT title_image_url FROM characters WHERE id = ?", [cid]);
    const r = await fetchRefImage(t[0]?.title_image_url, req.nextUrl.origin, "이 캐릭터의 대표(타이틀) 이미지 — 외형 기준");
    if (r) front.push(r);
  }
  if (body.useDefaultProfileRef === true && emotion !== "default") {
    const d = await query<{ url: string | null }>(
      "SELECT url FROM character_profiles WHERE character_id = ? AND emotion = 'default'",
      [cid]
    );
    const r = await fetchRefImage(d[0]?.url, req.nextUrl.origin, "이 캐릭터의 기본 프로필 이미지 — 같은 인물·같은 화풍 기준");
    if (r) front.push(r);
  }
  refs.push(...(await collectAssetRefs(body, { characterId: cid, worldId: Number(exists[0].world_id) }, req.nextUrl.origin)));
  refs.unshift(...front);
  if (refs.length > MAX_REFS) return bad(`참조 이미지는 합산 최대 ${MAX_REFS}장입니다.`);

  let buffer: Buffer;
  try {
    buffer = await generateImage(withRefNotes(prompt, refs), refs);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("admin profile generate error:", e);
    return bad(msg, msg.startsWith("이미지 생성이 설정되지") ? 400 : 502);
  }

  return NextResponse.json({ emotion, image: buffer.toString("base64"), mime: "image/png" }, { status: 201 });
}
