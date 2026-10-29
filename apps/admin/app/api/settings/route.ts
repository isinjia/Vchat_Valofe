import { NextRequest, NextResponse } from "next/server";
import {
  getSetting,
  setSetting,
  getLlmSettings,
  getFeeSettings,
  getPricingSettings,
  getImageGenSettings,
  DEFAULT_LLM_SETTINGS,
  type StorageSettings,
} from "@vchatbot/core";

export async function GET() {
  const [storage, llm, fees, pricing, imageGen] = await Promise.all([
    getSetting<StorageSettings>("storage"),
    getLlmSettings(),
    getFeeSettings(),
    getPricingSettings(),
    getImageGenSettings(),
  ]);
  // apiKey 는 마스킹해서 내려준다
  const image_gen = {
    ...imageGen,
    apiKey: imageGen.apiKey ? `****${imageGen.apiKey.slice(-4)}` : "",
  };
  return NextResponse.json({ storage, llm: llm ?? DEFAULT_LLM_SETTINGS, fees, pricing, image_gen });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  if (body.storage) await setSetting("storage", body.storage);
  if (body.llm) await setSetting("llm", body.llm);
  if (body.fees) {
    // 비율은 0~1 로 클램프
    const clamp = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
    await setSetting("fees", {
      creatorRate: clamp(body.fees.creatorRate),
      worldRate: clamp(body.fees.worldRate),
    });
  }
  if (body.pricing) {
    const nn = (n: unknown) => Math.max(0, Math.floor(Number(n) || 0));
    await setSetting("pricing", {
      aiAssistCost: nn(body.pricing.aiAssistCost),
      illustGenCost: nn(body.pricing.illustGenCost),
    });
  }
  if (body.image_gen) {
    const cur = await getImageGenSettings();
    const g = body.image_gen;
    // "__KEEP__" 또는 마스킹 값("****...")이면 기존 키 유지
    const keepKey = g.apiKey === "__KEEP__" || (typeof g.apiKey === "string" && g.apiKey.startsWith("****"));
    await setSetting("image_gen", {
      enabled: !!g.enabled,
      baseUrl: String(g.baseUrl ?? cur.baseUrl).trim(),
      apiKey: keepKey ? cur.apiKey : String(g.apiKey ?? ""),
      model: String(g.model ?? cur.model).trim(),
      size: String(g.size ?? cur.size).trim(),
    });
  }
  return NextResponse.json({ ok: true });
}
