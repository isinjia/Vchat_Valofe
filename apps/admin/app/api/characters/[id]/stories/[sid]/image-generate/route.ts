import { NextRequest, NextResponse } from "next/server";
import { generateImage, getStorage } from "@vchatbot/core";
import { storyOf } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string; sid: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** POST { prompt } — 스토리 카드 이미지 AI 생성 → 스토리지 업로드 → { url } (어드민: 과금 없음) */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, sid } = await params;
  const g = await storyOf(id, sid);
  if ("res" in g) return g.res;

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return bad("prompt 가 필요합니다.");

  let storage;
  try {
    storage = await getStorage();
  } catch (e) {
    return bad((e as Error).message);
  }

  let buffer: Buffer;
  try {
    buffer = await generateImage(prompt);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("admin story image generate error:", e);
    return bad(msg, msg.includes("등록되지 않았습니다") ? 400 : 502);
  }

  const key = `stories/${Number(id)}/${g.story.id}/${Date.now()}.png`;
  const url = await storage.upload(key, buffer, "image/png");
  return NextResponse.json({ url }, { status: 201 });
}
