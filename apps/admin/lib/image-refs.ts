import type { ReferenceImage } from "@vchatbot/core";

const MAX_REFS = 2;
const MAX_BYTES = 10 * 1024 * 1024;

/** body.refImages (base64 배열, 최대 2개, 각 디코드 후 10MB 이하) → ReferenceImage[]. 오류 시 { error } */
export function parseRefImages(raw: unknown): { refs: ReferenceImage[] } | { error: string } {
  if (raw == null) return { refs: [] };
  if (!Array.isArray(raw)) return { error: "refImages 형식이 올바르지 않습니다." };
  if (raw.length > MAX_REFS) return { error: `참조 이미지는 최대 ${MAX_REFS}장입니다.` };
  const refs: ReferenceImage[] = [];
  for (const it of raw) {
    const data = typeof it?.data === "string" ? it.data.replace(/^data:[^,]*,/, "") : "";
    const mimeType = typeof it?.mimeType === "string" ? it.mimeType : "";
    if (!data || !mimeType.startsWith("image/")) return { error: "참조 이미지 형식이 올바르지 않습니다." };
    const buf = Buffer.from(data, "base64");
    if (buf.length === 0) return { error: "참조 이미지를 읽을 수 없습니다." };
    if (buf.length > MAX_BYTES) return { error: "참조 이미지는 10MB 이하여야 합니다." };
    refs.push({ data: buf, mimeType });
  }
  return { refs };
}

/** 타이틀 이미지 URL 을 fetch 해 참조 이미지로. 실패 시 null (무시) */
export async function fetchRefImage(url: string | null | undefined, base?: string): Promise<ReferenceImage | null> {
  if (!url) return null;
  try {
    const res = await fetch(url.startsWith("/") && base ? new URL(url, base).toString() : url);
    if (!res.ok) return null;
    const mimeType = (res.headers.get("content-type") ?? "image/png").split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length === 0 || data.length > MAX_BYTES) return null;
    return { data, mimeType };
  } catch {
    return null;
  }
}
