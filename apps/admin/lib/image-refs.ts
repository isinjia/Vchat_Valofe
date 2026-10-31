import { query, type ReferenceImage } from "@vchatbot/core";

/** 참조 이미지 총 한도 (업로드 + 등록 자산 + 타이틀 합산) — openai images/edits·gemini 멀티모달 모두 수용 */
export const MAX_REFS = 4;
const MAX_BYTES = 10 * 1024 * 1024;

/** 설명(note)이 붙은 참조 이미지 — note 는 프롬프트의 [참조 이미지] 블록으로 들어가 생성 AI 를 돕는다 */
export interface NotedRef extends ReferenceImage {
  note?: string;
}

const EMOTION_LABELS: Record<string, string> = {
  default: "기본",
  joy: "기쁨",
  sad: "슬픔",
  angry: "화남",
  shy: "부끄러움",
  surprised: "놀람",
  love: "애정",
  neutral: "평온",
};

/** body.refImages (base64 배열, 최대 MAX_REFS개, 각 디코드 후 10MB 이하) → NotedRef[]. 오류 시 { error } */
export function parseRefImages(raw: unknown): { refs: NotedRef[] } | { error: string } {
  if (raw == null) return { refs: [] };
  if (!Array.isArray(raw)) return { error: "refImages 형식이 올바르지 않습니다." };
  if (raw.length > MAX_REFS) return { error: `참조 이미지는 최대 ${MAX_REFS}장입니다.` };
  const refs: NotedRef[] = [];
  for (const it of raw) {
    const data = typeof it?.data === "string" ? it.data.replace(/^data:[^,]*,/, "") : "";
    const mimeType = typeof it?.mimeType === "string" ? it.mimeType : "";
    if (!data || !mimeType.startsWith("image/")) return { error: "참조 이미지 형식이 올바르지 않습니다." };
    const buf = Buffer.from(data, "base64");
    if (buf.length === 0) return { error: "참조 이미지를 읽을 수 없습니다." };
    if (buf.length > MAX_BYTES) return { error: "참조 이미지는 10MB 이하여야 합니다." };
    refs.push({ data: buf, mimeType, note: "사용자가 업로드한 참조 이미지" });
  }
  return { refs };
}

/** 이미지 URL 을 fetch 해 참조 이미지로. 실패 시 null (무시) */
export async function fetchRefImage(
  url: string | null | undefined,
  base?: string,
  note?: string
): Promise<NotedRef | null> {
  if (!url) return null;
  try {
    const res = await fetch(url.startsWith("/") && base ? new URL(url, base).toString() : url);
    if (!res.ok) return null;
    const mimeType = (res.headers.get("content-type") ?? "image/png").split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length === 0 || data.length > MAX_BYTES) return null;
    return { data, mimeType, note };
  } catch {
    return null;
  }
}

function idList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_REFS);
}

/**
 * 등록된 자산(감정 프로필 / 캐릭터 일러스트 / 세계관 지역 배경 / 세계관 캐릭터 타이틀)을 id 로 받아
 * 설명을 붙인 참조 이미지로 수집. 소유 검증: 프로필·일러스트는 characterId, 배경·캐릭터 타이틀은
 * worldId 로 한정한다. 영상 일러스트는 제외하며, 가져오기 실패한 건 조용히 건너뜀.
 */
export async function collectAssetRefs(
  body: { refProfileIds?: unknown; refIllustIds?: unknown; refWorldIllustIds?: unknown; refCharacterTitleIds?: unknown },
  scope: { characterId?: number; worldId?: number },
  base?: string
): Promise<NotedRef[]> {
  const found: { url: string; note: string }[] = [];
  const profileIds = idList(body.refProfileIds);
  const illustIds = idList(body.refIllustIds);
  const worldIllustIds = idList(body.refWorldIllustIds);
  const charTitleIds = idList(body.refCharacterTitleIds);
  if (scope.characterId && profileIds.length > 0) {
    const rows = await query<{ url: string; emotion: string }>(
      `SELECT url, emotion FROM character_profiles WHERE character_id = ? AND id IN (${profileIds.map(() => "?").join(",")})`,
      [scope.characterId, ...profileIds]
    );
    found.push(
      ...rows.map((r) => ({ url: r.url, note: `이 캐릭터의 감정 프로필 이미지 (${EMOTION_LABELS[r.emotion] ?? r.emotion} 표정)` }))
    );
  }
  if (scope.characterId && illustIds.length > 0) {
    const rows = await query<{ url: string; description: string | null }>(
      `SELECT url, description FROM illustrations
       WHERE character_id = ? AND media_type = 'image' AND id IN (${illustIds.map(() => "?").join(",")})`,
      [scope.characterId, ...illustIds]
    );
    found.push(
      ...rows.map((r) => ({ url: r.url, note: `이 캐릭터의 일러스트${r.description ? ` — ${r.description}` : ""}` }))
    );
  }
  if (scope.worldId && worldIllustIds.length > 0) {
    const rows = await query<{ url: string; description: string | null; place_title: string | null }>(
      `SELECT wi.url, wi.description, d.title AS place_title
       FROM world_illustrations wi
       LEFT JOIN world_dictionary d ON d.id = wi.dict_entry_id
       WHERE wi.world_id = ? AND wi.id IN (${worldIllustIds.map(() => "?").join(",")})`,
      [scope.worldId, ...worldIllustIds]
    );
    found.push(
      ...rows.map((r) => ({
        url: r.url,
        note: `세계관 배경 이미지 (${r.place_title ?? "세계관 공통"})${r.description ? ` — ${r.description}` : ""}`,
      }))
    );
  }
  if (scope.worldId && charTitleIds.length > 0) {
    const rows = await query<{ name: string; title_image_url: string | null }>(
      `SELECT name, title_image_url FROM characters
       WHERE world_id = ? AND id IN (${charTitleIds.map(() => "?").join(",")})`,
      [scope.worldId, ...charTitleIds]
    );
    found.push(
      ...rows
        .filter((r) => !!r.title_image_url)
        .map((r) => ({ url: r.title_image_url!, note: `이 세계관 캐릭터 '${r.name}' 의 대표(타이틀) 이미지` }))
    );
  }
  const refs: NotedRef[] = [];
  for (const f of found) {
    const r = await fetchRefImage(f.url, base, f.note);
    if (r) refs.push(r);
  }
  return refs;
}

/**
 * 참조 이미지 설명 블록을 프롬프트 뒤에 붙인다 (전달 순서 = 번호 순서).
 * 생성 AI 가 각 참조가 무엇인지 알면 외형 유지/배경 반영에 도움이 된다.
 */
export function withRefNotes(prompt: string, refs: NotedRef[]): string {
  if (refs.length === 0) return prompt;
  const lines = refs.map((r, i) => `참조 ${i + 1}: ${r.note ?? "참조 이미지"}`);
  return `${prompt}\n\n[참조 이미지 — 전달 순서대로]\n${lines.join("\n")}`;
}
