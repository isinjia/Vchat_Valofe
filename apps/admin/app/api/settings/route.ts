import { NextRequest, NextResponse } from "next/server";
import {
  getSetting,
  setSetting,
  getLlmSettings,
  getFeeSettings,
  getPricingSettings,
  getImageGenSettings,
  getScoringSettings,
  DEFAULT_LLM_SETTINGS,
  AI_ASSIST_KINDS,
  type StorageSettings,
} from "@vchatbot/core";

export async function GET() {
  const [storage, llm, fees, pricing, imageGen, scoring] = await Promise.all([
    getSetting<StorageSettings>("storage"),
    getLlmSettings(),
    getFeeSettings(),
    getPricingSettings(),
    getImageGenSettings(),
    getScoringSettings(),
  ]);
  // apiKey 는 마스킹해서 내려준다
  const image_gen = {
    ...imageGen,
    apiKey: imageGen.apiKey ? `****${imageGen.apiKey.slice(-4)}` : "",
  };
  return NextResponse.json({ storage, llm: llm ?? DEFAULT_LLM_SETTINGS, fees, pricing, image_gen, scoring });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  if (body.storage) await setSetting("storage", body.storage);
  if (body.llm) {
    const l = body.llm;
    const idOrNull = (v: unknown) => {
      const n = Number(v);
      return v != null && v !== "" && Number.isInteger(n) && n > 0 ? n : null;
    };
    await setSetting("llm", {
      ...l,
      assistProviderId: idOrNull(l.assistProviderId),
      fallbackProviderId: idOrNull(l.fallbackProviderId),
    });
  }
  if (body.scoring) {
    const cur = await getScoringSettings();
    const sc = body.scoring;
    const pid = Number(sc.scoringProviderId);
    const tms = Math.floor(Number(sc.timeoutMs));
    await setSetting("scoring", {
      ...cur,
      scoringProviderId:
        sc.scoringProviderId != null && sc.scoringProviderId !== "" && Number.isInteger(pid) && pid > 0 ? pid : null,
      timeoutMs: Number.isFinite(tms) && tms >= 1000 ? tms : cur.timeoutMs,
    });
  }
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
    // kind별 과금: 목록에 있는 kind 만 저장
    const aiAssist: Record<string, { coinsPer1k: number; minCost: number }> = {};
    const src = body.pricing.aiAssist && typeof body.pricing.aiAssist === "object" ? body.pricing.aiAssist : {};
    for (const k of AI_ASSIST_KINDS) {
      if (src[k]) aiAssist[k] = { coinsPer1k: nn(src[k].coinsPer1k), minCost: nn(src[k].minCost) };
    }
    await setSetting("pricing", {
      aiAssistCost: nn(body.pricing.aiAssistCost),
      illustGenCost: nn(body.pricing.illustGenCost),
      aiAssist,
      byok: { enabled: !!body.pricing.byok?.enabled, cost: nn(body.pricing.byok?.cost) },
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
