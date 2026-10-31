import { query } from "./mysql";

/**
 * 프로필 세트: 조건(계절/기념일 전후 기간/호감도/감정)에 맞는 세트를 카테고리별로 골라
 * 채팅 아바타를 배경 → 얼굴(감정별) → 효과 순으로 겹쳐 표시한다.
 *  - background: 원 안 맨 아래 이미지 1장 (조건 없으면 항상 적용되는 기본 배경)
 *  - face: 감정별 투명배경 이미지. 충족 세트가 없으면 기존 기본 프로필(character_profiles) 폴백
 *  - effect: 원 밖까지 덮는 오버레이 1장 (조건 필수 — 기본은 효과 없음. 감정 조건 지원)
 */

export type Season = "spring" | "summer" | "autumn" | "winter";
export type ProfileSetCategory = "background" | "face" | "effect";

/** 효과 오버레이 배치: 원 지름=1 기준 크기/오프셋 */
export interface ProfileEffect {
  url: string;
  scale: number;
  x: number;
  y: number;
}

/** 감정 키 하나에 대한 아바타 구성 */
export interface ProfileVisual {
  /** 원 안에 클리핑되는 레이어 (아래→위): 배경?, 얼굴(또는 기존 단일 프로필) */
  layers: string[];
  /** 원 밖까지 덮는 효과 오버레이 */
  effect?: ProfileEffect | null;
}

/** 감정 키 -> 아바타 구성 */
export type ProfileVisualMap = Record<string, ProfileVisual>;

export interface ProfileSetRow {
  id: number;
  character_id: number;
  category: ProfileSetCategory;
  name: string;
  season: Season | null;
  anniversary_id: number | null;
  days_before: number;
  days_after: number;
  min_affinity: number | null;
  emotion: string | null;
  /** face 전용: 배경 호환 규칙 (NULL = 전부 허용) */
  bg_rule: { mode: "allow" | "deny"; ids: number[] } | string | null;
  storage_key: string | null;
  url: string | null;
  effect_scale: number;
  effect_x: number;
  effect_y: number;
  sort_order: number;
  created_at: string;
}

type SetWithAnniv = ProfileSetRow & {
  anniv_month: number | null;
  anniv_day: number | null;
  anniv_duration: number | null;
};

/** 월 기준 계절 (3~5 봄, 6~8 여름, 9~11 가을, 12~2 겨울) */
export function currentSeason(today: Date = new Date()): Season {
  const m = today.getMonth() + 1;
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return "winter";
}

/**
 * 오늘이 기념일 기간(시작 days_before 일 전 ~ 종료 days_after 일 후) 안인지.
 * 연도 경계(12월 말 → 1월 초)를 처리하고, 존재하지 않는 날짜(비윤년 2/29)는 건너뛴다.
 */
export function isAnniversaryWindowActive(
  a: { month: number; day: number; duration_days?: number | null },
  daysBefore: number,
  daysAfter: number,
  today: Date = new Date()
): boolean {
  const duration = Math.max(1, Number(a.duration_days ?? 1));
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  for (const y of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    const start = new Date(Date.UTC(y, a.month - 1, a.day));
    if (start.getUTCMonth() !== a.month - 1) continue;
    const d = Math.round((todayUtc - start.getTime()) / 86400000); // 시작일로부터 지난 일수
    if (d >= -Math.max(0, daysBefore) && d < duration + Math.max(0, daysAfter)) return true;
  }
  return false;
}

/** 세트가 지금(오늘/호감도/감정) 조건을 모두 충족하는지. emotion 조건은 해당 감정 키에서만 통과 */
function setMatches(s: SetWithAnniv, affinity: number, emotion: string, today: Date): boolean {
  if (s.season != null && s.season !== currentSeason(today)) return false;
  if (s.anniversary_id != null) {
    // 기념일이 삭제돼 조인이 비면 조건 불충족 (fail-closed)
    if (s.anniv_month == null || s.anniv_day == null) return false;
    if (
      !isAnniversaryWindowActive(
        { month: s.anniv_month, day: s.anniv_day, duration_days: s.anniv_duration },
        Number(s.days_before) || 0,
        Number(s.days_after) || 0,
        today
      )
    ) {
      return false;
    }
  }
  if (s.min_affinity != null && affinity < Number(s.min_affinity)) return false;
  if (s.emotion != null && s.emotion !== emotion) return false;
  return true;
}

/** 충족 세트를 우선순위로 정렬: 구체적일수록(감정>기념일>계절>호감도) 우선, 동점이면 min_affinity 큰 쪽 → 최신 id */
function sortByPriority<T extends ProfileSetRow>(matched: T[]): T[] {
  const score = (s: ProfileSetRow) =>
    (s.emotion != null ? 8 : 0) +
    (s.anniversary_id != null ? 4 : 0) +
    (s.season != null ? 2 : 0) +
    (s.min_affinity != null ? 1 : 0);
  return [...matched].sort(
    (a, b) =>
      score(b) - score(a) ||
      Number(b.min_affinity ?? -101) - Number(a.min_affinity ?? -101) ||
      b.id - a.id
  );
}

function pickBestSet<T extends ProfileSetRow>(matched: T[]): T | null {
  return sortByPriority(matched)[0] ?? null;
}

/** face 세트의 배경 호환 규칙 해석 — 규칙 없으면 전부 허용 */
export function bgAllowedByRule(rule: ProfileSetRow["bg_rule"], bgSetId: number): boolean {
  if (rule == null) return true;
  let r: { mode?: string; ids?: unknown };
  try {
    r = typeof rule === "string" ? JSON.parse(rule) : rule;
  } catch {
    return true;
  }
  const ids = Array.isArray(r?.ids) ? r.ids.map(Number) : [];
  if (r?.mode === "allow") return ids.includes(bgSetId);
  if (r?.mode === "deny") return !ids.includes(bgSetId);
  return true;
}

/** 프로필 이미지 감정 키 (스튜디오 등록 슬롯과 동일) */
export const PROFILE_EMOTION_KEYS = ["default", "joy", "sad", "angry", "shy", "surprised", "love", "neutral"];

/**
 * 채팅 화면용 아바타 구성 해석. 감정 키별로 { layers:[배경?,얼굴], effect? } 를 돌려준다.
 * 얼굴세트가 없으면 기존 기본 프로필(character_profiles)을 얼굴로 쓴다.
 */
export async function resolveProfileVisuals(
  characterId: number,
  userId: number | null,
  today: Date = new Date()
): Promise<ProfileVisualMap> {
  const defaults = await query<{ emotion: string; url: string }>(
    "SELECT emotion, url FROM character_profiles WHERE character_id = ?",
    [characterId]
  );
  const defaultFace = new Map(defaults.map((p) => [p.emotion, p.url]));

  // 고급 프로필 OFF 면 세트 판정 없이 기본 프로필만 사용
  const flag = await query<{ advanced_profile: number }>(
    "SELECT advanced_profile FROM characters WHERE id = ?",
    [characterId]
  );
  if (!flag[0]?.advanced_profile) {
    const basic: ProfileVisualMap = {};
    for (const [emotion, url] of defaultFace) basic[emotion] = { layers: [url], effect: null };
    return basic;
  }

  const sets = await query<SetWithAnniv>(
    `SELECT s.*, a.month AS anniv_month, a.day AS anniv_day, a.duration_days AS anniv_duration
     FROM character_profile_sets s
     LEFT JOIN world_anniversaries a ON a.id = s.anniversary_id
     WHERE s.character_id = ?
     ORDER BY s.sort_order, s.id`,
    [characterId]
  );

  let affinity = 0;
  if (userId != null && sets.some((s) => s.min_affinity != null)) {
    const st = await query<{ affinity: number }>(
      "SELECT affinity FROM user_character_state WHERE user_id = ? AND character_id = ?",
      [userId, characterId]
    );
    affinity = Number(st[0]?.affinity ?? 0);
  }

  // 얼굴세트 감정별 이미지 로드 (face 카테고리만 items 보유)
  const faceSetIds = sets.filter((s) => s.category === "face").map((s) => s.id);
  const items = faceSetIds.length
    ? await query<{ set_id: number; emotion: string; url: string }>(
        `SELECT set_id, emotion, url FROM character_profile_items
         WHERE set_id IN (${faceSetIds.map(() => "?").join(",")}) ORDER BY id`,
        faceSetIds
      )
    : [];
  const faceItems = new Map<number, Map<string, string>>();
  for (const it of items) {
    const m = faceItems.get(it.set_id) ?? new Map<string, string>();
    m.set(it.emotion, it.url);
    faceItems.set(it.set_id, m);
  }

  const map: ProfileVisualMap = {};
  for (const emotion of PROFILE_EMOTION_KEYS) {
    const matched = (cat: ProfileSetCategory) =>
      sets.filter((s) => s.category === cat && setMatches(s, affinity, emotion, today));

    // 얼굴: 이미지가 있는 세트 중 (이 감정 또는 default 슬롯 보유) 우선 세트
    const face = pickBestSet(
      matched("face").filter((s) => {
        const m = faceItems.get(s.id);
        return !!m && (m.has(emotion) || m.has("default"));
      })
    );
    const faceUrl = face
      ? (faceItems.get(face.id)!.get(emotion) ?? faceItems.get(face.id)!.get("default") ?? null)
      : (defaultFace.get(emotion) ?? null);
    // 배경: 우선순위대로 보되, 선택된 얼굴세트의 허용/차단 규칙에 맞는 첫 배경 (기본 프로필 폴백 얼굴은 규칙 없음)
    const bg =
      sortByPriority(matched("background").filter((s) => !!s.url)).find((b) =>
        bgAllowedByRule(face?.bg_rule ?? null, b.id)
      ) ?? null;
    const effect = pickBestSet(matched("effect").filter((s) => !!s.url));

    const layers = [bg?.url ?? null, faceUrl].filter((u): u is string => !!u);
    if (layers.length === 0 && !effect) continue;
    map[emotion] = {
      layers,
      effect: effect
        ? {
            url: effect.url!,
            scale: Number(effect.effect_scale) || 1,
            x: Number(effect.effect_x) || 0,
            y: Number(effect.effect_y) || 0,
          }
        : null,
    };
  }
  return map;
}
