import { query } from "./mysql";
import { getImageGenSettings } from "./settings";
import type { ImageProviderRow } from "./types";

const TIMEOUT_MS = 180_000;

/** 생성 시 참조할 이미지 (타이틀 이미지, 업로드 이미지 등) */
export interface ReferenceImage {
  data: Buffer;
  mimeType: string;
}

/** 기본(또는 활성 첫) 이미지 생성 프로바이더. 없으면 null */
export async function resolveImageProvider(): Promise<ImageProviderRow | null> {
  const rows = await query<ImageProviderRow>(
    "SELECT * FROM image_providers WHERE is_active = 1 ORDER BY is_default DESC, id LIMIT 1"
  );
  return rows[0] ?? null;
}

/**
 * 이미지를 1장 생성해 Buffer 로 반환한다.
 * image_providers 의 기본 프로바이더 사용. 없으면 레거시 설정(app_settings.image_gen) 폴백.
 * refs 가 있으면 참조 이미지와 함께 생성한다 (openai: images/edits, gemini: 멀티모달 입력).
 */
export async function generateImage(prompt: string, refs: ReferenceImage[] = []): Promise<Buffer> {
  const p = await resolveImageProvider();
  if (p) {
    if (!p.api_key) throw new Error(`이미지 생성 AI "${p.name}" 에 API 키가 등록되지 않았습니다.`);
    if (p.provider === "gemini") return generateGemini(p, prompt, refs);
    return generateOpenAi(p, prompt, refs);
  }

  // 레거시: 관리자 설정(image_gen) — 참조 이미지 미지원
  const s = await getImageGenSettings();
  if (!s.enabled || !s.apiKey) {
    throw new Error("이미지 생성 AI 가 등록되지 않았습니다. 관리자 > LLM 관리 > 이미지 생성 AI 에서 등록하세요.");
  }
  return generateOpenAi(
    {
      id: 0,
      name: "레거시 설정",
      provider: "openai_compatible",
      model: s.model,
      api_key: s.apiKey,
      base_url: s.baseUrl,
      size: s.size,
      cost_per_image: 0,
      cost_currency: "USD",
      is_default: 1,
      is_active: 1,
      created_at: "",
      updated_at: "",
    },
    prompt,
    refs
  );
}

/** OpenAI / OpenAI 호환 images API. refs 가 있으면 images/edits(multipart), 없으면 images/generations */
async function generateOpenAi(
  p: ImageProviderRow,
  prompt: string,
  refs: ReferenceImage[]
): Promise<Buffer> {
  const base = (p.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  let res: Response;
  if (refs.length > 0) {
    const form = new FormData();
    form.append("model", p.model);
    form.append("prompt", prompt);
    if (/^\d+x\d+$/.test(p.size.trim())) form.append("size", p.size.trim());
    form.append("n", "1");
    for (let i = 0; i < refs.length; i++) {
      form.append("image[]", new Blob([new Uint8Array(refs[i].data)], { type: refs[i].mimeType }), `ref-${i}.png`);
    }
    res = await fetch(`${base}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.api_key}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } else {
    const body: Record<string, unknown> = { model: p.model, prompt, n: 1 };
    if (/^\d+x\d+$/.test(p.size.trim())) body.size = p.size.trim();
    res = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.api_key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`이미지 생성 API 오류 (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = json.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!img.ok) throw new Error(`생성된 이미지 다운로드 실패 (${img.status})`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error("이미지 생성 결과가 비어 있습니다.");
}

/** Gemini generateContent (이미지 출력 모델, 예: gemini-2.5-flash-image). refs 는 멀티모달 입력으로 전달 */
async function generateGemini(
  p: ImageProviderRow,
  prompt: string,
  refs: ReferenceImage[]
): Promise<Buffer> {
  const base = (p.base_url || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const r of refs) {
    parts.push({ inline_data: { mime_type: r.mimeType, data: r.data.toString("base64") } });
  }
  const generationConfig: Record<string, unknown> = { responseModalities: ["TEXT", "IMAGE"] };
  const aspect = sizeToAspectRatio(p.size);
  if (aspect) generationConfig.imageConfig = { aspectRatio: aspect };

  const res = await fetch(`${base}/v1beta/models/${p.model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": p.api_key ?? "" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini 이미지 생성 오류 (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string }; inline_data?: { data?: string } }[] } }[];
  };
  for (const part of json.candidates?.[0]?.content?.parts ?? []) {
    const b64 = part.inlineData?.data ?? part.inline_data?.data;
    if (b64) return Buffer.from(b64, "base64");
  }
  throw new Error("Gemini 가 이미지를 반환하지 않았습니다. (모델이 이미지 출력을 지원하는지 확인하세요)");
}

/** 'WxH' 또는 'n:m' 을 Gemini aspectRatio 로 변환 (지원 비율 중 가장 가까운 값) */
function sizeToAspectRatio(size: string): string | null {
  const s = size.trim();
  if (/^\d+:\d+$/.test(s)) return s;
  const m = /^(\d+)x(\d+)$/.exec(s);
  if (!m) return null;
  const ratio = Number(m[1]) / Number(m[2]);
  const supported: [string, number][] = [
    ["1:1", 1],
    ["2:3", 2 / 3],
    ["3:2", 3 / 2],
    ["3:4", 3 / 4],
    ["4:3", 4 / 3],
    ["4:5", 4 / 5],
    ["5:4", 5 / 4],
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
    ["21:9", 21 / 9],
  ];
  let best: string = "1:1";
  let bestDiff = Infinity;
  for (const [label, r] of supported) {
    const diff = Math.abs(r - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = label;
    }
  }
  return best;
}
