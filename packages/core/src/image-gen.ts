import { getImageGenSettings } from "./settings";

const TIMEOUT_MS = 120_000;

/**
 * OpenAI 호환 images API 로 이미지를 1장 생성해 Buffer 로 반환한다.
 * 설정(관리자 > 이미지 생성)이 없거나 비활성이면 Error.
 */
export async function generateImage(prompt: string): Promise<Buffer> {
  const s = await getImageGenSettings();
  if (!s.enabled || !s.apiKey) {
    throw new Error("이미지 생성이 설정되지 않았습니다. 관리자 설정에서 이미지 생성 API 를 등록하세요.");
  }

  const res = await fetch(`${s.baseUrl.replace(/\/+$/, "")}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({ model: s.model, prompt, size: s.size, n: 1 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
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
