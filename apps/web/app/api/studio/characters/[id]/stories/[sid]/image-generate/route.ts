import { NextRequest, NextResponse } from "next/server";
import { generateImage, getStorage, chargeCoins, getPricingSettings } from "@vchatbot/core";
import { requireUser, bad } from "@/lib/studio";
import { ownedStory } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
type Params = { params: Promise<{ id: string; sid: string }> };

/**
 * POST { prompt } — 스토리 카드 이미지 AI 생성 → 스토리지 업로드 → { url }.
 * 생성 성공 시 일러스트 생성 단가(illustGenCost)로 차감.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, sid } = await params;
  const g = await ownedStory(id, sid, auth.userId);
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
    console.error("story image generate error:", e);
    return bad(msg, msg.includes("등록되지 않았습니다") ? 400 : 502);
  }

  const key = `stories/${Number(id)}/${g.story.id}/${Date.now()}.png`;
  const url = await storage.upload(key, buffer, "image/png");

  const cost = (await getPricingSettings()).illustGenCost;
  const balance = await chargeCoins(auth.userId, cost, "illust_gen_spend", {
    refType: "character",
    refId: Number(id),
    memo: "story_card_image",
  });
  return NextResponse.json({ url, cost, balance }, { status: 201 });
}
