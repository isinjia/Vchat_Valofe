import { query, type ReferenceImage } from "@vchatbot/core";

/** 참조 이미지 총 한도 (업로드 + 등록 자산 + 타이틀 합산) — openai images/edits·gemini 멀티모달 모두 수용 */
export const MAX_REFS = 4;
const MAX_BYTES = 10 * 1024 * 1024;

/** body.refImages (base64 배열, 최대 MAX_REFS개, 각 디코드 후 10MB 이하) → ReferenceImage[]. 오류 시 { error } */
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

function idList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_REFS);
}

/**
 * 등록된 자산(감정 프로필 / 캐릭터 일러스트 / 세계관 지역 배경)을 id 로 받아 참조 이미지로 수집.
 * 소유 검증: 프로필·일러스트는 characterId, 세계관 배경은 worldId 로 한정한다. 가져오기 실패한 건 조용히 건너뜀.
 */
export async function collectAssetRefs(
  body: { refProfileIds?: unknown; refIllustIds?: unknown; refWorldIllustIds?: unknown },
  scope: { characterId?: number; worldId?: number },
  base?: string
): Promise<ReferenceImage[]> {
  const urls: string[] = [];
  const profileIds = idList(body.refProfileIds);
  const illustIds = idList(body.refIllustIds);
  const worldIllustIds = idList(body.refWorldIllustIds);
  if (scope.characterId && profileIds.length > 0) {
    const rows = await query<{ url: string }>(
      `SELECT url FROM character_profiles WHERE character_id = ? AND id IN (${profileIds.map(() => "?").join(",")})`,
      [scope.characterId, ...profileIds]
    );
    urls.push(...rows.map((r) => r.url));
  }
  if (scope.characterId && illustIds.length > 0) {
    const rows = await query<{ url: string }>(
      `SELECT url FROM illustrations WHERE character_id = ? AND id IN (${illustIds.map(() => "?").join(",")})`,
      [scope.characterId, ...illustIds]
    );
    urls.push(...rows.map((r) => r.url));
  }
  if (scope.worldId && worldIllustIds.length > 0) {
    const rows = await query<{ url: string }>(
      `SELECT url FROM world_illustrations WHERE world_id = ? AND id IN (${worldIllustIds.map(() => "?").join(",")})`,
      [scope.worldId, ...worldIllustIds]
    );
    urls.push(...rows.map((r) => r.url));
  }
  const refs: ReferenceImage[] = [];
  for (const u of urls) {
    const r = await fetchRefImage(u, base);
    if (r) refs.push(r);
  }
  return refs;
}
