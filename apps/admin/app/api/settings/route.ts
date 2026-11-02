import { NextRequest, NextResponse } from "next/server";
import {
  getSetting,
  setSetting,
  getLlmSettings,
  getFeeSettings,
  getPricingSettings,
  getImageGenSettings,
  getScoringSettings,
  getBillingSettings,
  getAffinityPromptDefaults,
  parseAffinityPrompts,
  getVmsgSettings,
  normalizeVmsgSettings,
  DEFAULT_LLM_SETTINGS,
  AI_ASSIST_KINDS,
  type StorageSettings,
} from "@vchatbot/core";

/** 시크릿 마스킹 (뒤 4자리만 노출) */
const mask = (v: string) => (v ? `****${v.slice(-4)}` : "");

export async function GET() {
  const [storage, llm, fees, pricing, imageGen, scoring, billing, affinityPrompts, vmsg] = await Promise.all([
    getSetting<StorageSettings>("storage"),
    getLlmSettings(),
    getFeeSettings(),
    getPricingSettings(),
    getImageGenSettings(),
    getScoringSettings(),
    getBillingSettings(),
    getAffinityPromptDefaults(),
    getVmsgSettings(),
  ]);
  // apiKey 는 마스킹해서 내려준다
  const image_gen = {
    ...imageGen,
    apiKey: imageGen.apiKey ? `****${imageGen.apiKey.slice(-4)}` : "",
  };
  return NextResponse.json({
    storage,
    llm: llm ?? DEFAULT_LLM_SETTINGS,
    fees,
    pricing,
    image_gen,
    scoring,
    billing,
    affinity_prompts: affinityPrompts,
    // 챗봇 secret 은 마스킹해서 내려준다 (수정하지 않으면 그대로 전송 → 서버가 기존 값 유지)
    vmsg: { ...vmsg, bots: vmsg.bots.map((b) => ({ ...b, clientSecret: mask(b.clientSecret) })) },
  });
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
      giftRate: clamp(body.fees.giftRate),
    });
  }
  if (body.billing) {
    await setSetting("billing", { chargeUrl: String(body.billing.chargeUrl ?? "").trim() });
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
      videoGenCost: nn(body.pricing.videoGenCost),
      aiAssist,
      byok: { enabled: !!body.pricing.byok?.enabled, cost: nn(body.pricing.byok?.cost) },
    });
  }
  if (body.affinity_prompts) {
    // 알려진 구간 키의 비어있지 않은 텍스트만 저장 (비운 구간은 내장 기본값으로 폴백)
    await setSetting("affinity_prompts", parseAffinityPrompts(body.affinity_prompts) ?? {});
  }
  if (body.vmsg) {
    const cur = await getVmsgSettings();
    const next = normalizeVmsgSettings(body.vmsg);
    // 마스킹 값("****...") 또는 빈 secret 은 기존 값 유지 (botClientId 로 매칭)
    next.bots = next.bots.map((b) => {
      const keep = !b.clientSecret || b.clientSecret.startsWith("****");
      if (!keep) return b;
      const prev = cur.bots.find((p) => p.botClientId === b.botClientId);
      return { ...b, clientSecret: prev?.clientSecret ?? "" };
    });
    await setSetting("vmsg", next);
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
