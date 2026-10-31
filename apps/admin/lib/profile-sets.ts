import { query } from "@vchatbot/core";

/** 프로필 이미지 감정 키 (character_profiles 와 동일) */
export const PROFILE_EMOTIONS = ["default", "joy", "sad", "angry", "shy", "surprised", "love", "neutral"];

export const PROFILE_SET_CATEGORIES = ["background", "face", "effect"] as const;

const SEASONS = ["spring", "summer", "autumn", "winter"];

export interface ProfileSetConditions {
  name: string;
  season: string | null;
  anniversary_id: number | null;
  days_before: number;
  days_after: number;
  min_affinity: number | null;
  emotion: string | null;
  /** face 전용 배경 호환 규칙 JSON 문자열 (NULL = 전부 허용) */
  bg_rule: string | null;
}

/**
 * 프로필 세트 조건 입력 검증 (생성/수정 공용 — category 는 생성 시 고정).
 *  - 기념일은 캐릭터 세계관의 기념일(공통 또는 이 캐릭터 개인)만 허용
 *  - 감정 조건은 effect 카테고리 전용
 *  - effect 는 조건이 하나 이상 필수 (기본은 효과 없음), background/face 는 조건 없으면 항상 적용
 */
export async function parseProfileSetInput(
  body: unknown,
  category: string,
  worldId: number,
  characterId: number
): Promise<{ value: ProfileSetConditions } | { error: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { error: "세트 이름이 필요합니다." };
  if (name.length > 100) return { error: "세트 이름은 100자 이하여야 합니다." };

  let season: string | null = null;
  if (b.season != null && b.season !== "") {
    if (!SEASONS.includes(String(b.season))) return { error: "season 값이 올바르지 않습니다." };
    season = String(b.season);
  }

  let anniversaryId: number | null = null;
  if (b.anniversaryId != null && b.anniversaryId !== "") {
    const n = Number(b.anniversaryId);
    if (!Number.isInteger(n) || n <= 0) return { error: "anniversaryId 가 올바르지 않습니다." };
    const rows = await query(
      `SELECT id FROM world_anniversaries
       WHERE id = ? AND world_id = ? AND (character_id IS NULL OR character_id = ?)`,
      [n, worldId, characterId]
    );
    if (rows.length === 0) return { error: "이 캐릭터 세계관의 기념일이 아닙니다." };
    anniversaryId = n;
  }

  const nn = (v: unknown) => {
    if (v == null || v === "") return 0;
    const n = Number(v);
    return Number.isInteger(n) ? n : NaN;
  };
  const daysBefore = nn(b.daysBefore);
  const daysAfter = nn(b.daysAfter);
  if (!Number.isFinite(daysBefore) || daysBefore < 0 || daysBefore > 60) return { error: "기념일 전 일수는 0~60 사이여야 합니다." };
  if (!Number.isFinite(daysAfter) || daysAfter < 0 || daysAfter > 60) return { error: "기념일 후 일수는 0~60 사이여야 합니다." };

  let minAffinity: number | null = null;
  if (b.minAffinity != null && b.minAffinity !== "") {
    const n = Number(b.minAffinity);
    if (!Number.isInteger(n) || n < -100 || n > 100) return { error: "호감도 최소는 -100~100 사이 정수여야 합니다." };
    minAffinity = n;
  }

  let emotion: string | null = null;
  if (b.emotion != null && b.emotion !== "") {
    if (category !== "effect") return { error: "감정 조건은 효과세트에서만 지정할 수 있습니다." };
    if (!PROFILE_EMOTIONS.includes(String(b.emotion))) return { error: "emotion 조건이 올바르지 않습니다." };
    emotion = String(b.emotion);
  }

  if (category === "effect" && !season && !anniversaryId && minAffinity == null && !emotion) {
    return { error: "효과세트는 계절·기념일·호감도·감정 중 하나 이상의 조건이 필요합니다." };
  }

  // 배경 호환 규칙 (face 전용): bgMode 'all'(기본)=NULL, 'allow'/'deny'=이 캐릭터의 배경세트 id 목록
  let bgRule: string | null = null;
  const bgMode = b.bgMode == null || b.bgMode === "" ? "all" : String(b.bgMode);
  if (bgMode !== "all") {
    if (category !== "face") return { error: "배경 호환 규칙은 얼굴세트에서만 지정할 수 있습니다." };
    if (bgMode !== "allow" && bgMode !== "deny") return { error: "bgMode 는 all/allow/deny 중 하나여야 합니다." };
    const raw = Array.isArray(b.bgIds) ? b.bgIds : [];
    const ids = [...new Set(raw.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return { error: "허용/차단할 배경세트를 하나 이상 선택하세요." };
    const rows = await query<{ id: number }>(
      `SELECT id FROM character_profile_sets
       WHERE character_id = ? AND category = 'background' AND id IN (${ids.map(() => "?").join(",")})`,
      [characterId, ...ids]
    );
    if (rows.length !== ids.length) return { error: "이 캐릭터의 배경세트가 아닌 항목이 있습니다." };
    bgRule = JSON.stringify({ mode: bgMode, ids });
  }

  return {
    value: {
      name,
      season,
      anniversary_id: anniversaryId,
      days_before: daysBefore,
      days_after: daysAfter,
      min_affinity: minAffinity,
      emotion,
      bg_rule: bgRule,
    },
  };
}
