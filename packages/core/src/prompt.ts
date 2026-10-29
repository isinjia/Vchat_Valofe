import type {
  ChatMemory,
  CharacterPersona,
  CharacterRelationship,
  DictionaryEntry,
  Illustration,
  World,
  WorldAnniversary,
} from "./types";

const CATEGORY_LABEL: Record<DictionaryEntry["category"], string> = {
  location: "지역사전",
  person: "인명사전",
  term: "용어사전",
};

export interface ChatContext {
  world: World;
  dictionary: DictionaryEntry[];
  character: CharacterPersona;
  relationships: CharacterRelationship[];
  illustrations: Illustration[];
  anniversaries: WorldAnniversary[];
}

/**
 * 세계관 + 사전 + 캐릭터 페르소나를 하나의 시스템 프롬프트로 조립한다.
 * 이 문자열은 프롬프트 캐싱(cache_control) 대상이므로,
 * 매 요청마다 바뀌는 값(시간, 유저명 등)은 절대 넣지 않는다.
 */
export function buildSystemPrompt(
  ctx: ChatContext,
  opts: { includeDictionary?: boolean } = {}
): string {
  const includeDictionary = opts.includeDictionary ?? true;
  const { world, dictionary, character, relationships } = ctx;
  const parts: string[] = [];

  parts.push(`# 역할
당신은 아래 세계관 속에 실존하는 캐릭터 "${character.name}" 입니다.
AI 라는 사실을 절대 드러내지 말고, 캐릭터로서 일관되게 대화하세요.`);

  parts.push(`# 세계관: ${world.name}\n${world.description}`);

  if (world.ai_prompt.trim()) {
    parts.push(`# 세계관 공통 지침\n${world.ai_prompt}`);
  }

  for (const category of includeDictionary ? (["location", "person", "term"] as const) : []) {
    const entries = dictionary.filter((d) => d.category === category);
    if (entries.length === 0) continue;
    const body = entries
      .map((e) => {
        const alias = e.aliases ? ` (별칭: ${e.aliases})` : "";
        return `- ${e.title}${alias}: ${e.content}`;
      })
      .join("\n");
    parts.push(`# ${CATEGORY_LABEL[category]}\n${body}`);
  }

  parts.push(`# 캐릭터 설정: ${character.name}\n${character.profile}`);
  parts.push(`# 성격\n${character.personality}`);
  parts.push(`# 말투\n${character.speech_style}`);

  if (relationships.length > 0) {
    const fmt = (r: CharacterRelationship) =>
      `- ${r.target_title ?? `항목#${r.target_entry_id}`}: ${r.relation}`;
    // 인물 대상 → 관계, 지역/용어 대상 → 장소·사물에 얽힌 기억
    const persons = relationships.filter((r) => (r.target_category ?? "person") === "person");
    const memories = relationships.filter((r) => (r.target_category ?? "person") !== "person");
    if (persons.length > 0) {
      parts.push(`# 다른 캐릭터와의 관계\n${persons.map(fmt).join("\n")}`);
    }
    if (memories.length > 0) {
      parts.push(`# 장소·사물에 얽힌 기억\n${memories.map(fmt).join("\n")}`);
    }
  }

  // 대화 시작 상황 (캐릭터별 고정값이라 캐싱에 영향 없음)
  if (character.scenario?.trim()) {
    parts.push(`# 현재 상황\n${character.scenario}`);
  }

  if (character.ai_prompt.trim()) {
    parts.push(`# 캐릭터 상세 지침\n${character.ai_prompt}`);
  }

  return parts.join("\n\n");
}

/** 채팅 오프닝(첫 대사 AI 생성) 시 user 로 보내는 지시문. Mongo 에는 저장하지 않는다 */
export const OPENING_INSTRUCTION =
  "(대화 시작. 아직 유저는 아무 말도 하지 않았다. 설정된 상황에서 캐릭터가 먼저 건네는 첫 대사/행동 묘사를 2~4문장으로 출력하라. 대사 외 메타 설명 금지)";

/** RAG 로 선별된 사전 항목을 user 메시지 앞에 붙일 참고 블록으로 만든다 */
export function formatReferenceBlock(entries: DictionaryEntry[]): string {
  const body = entries
    .map((e) => {
      const alias = e.aliases ? ` (별칭: ${e.aliases})` : "";
      return `- (${CATEGORY_LABEL[e.category]}) ${e.title}${alias}: ${e.content}`;
    })
    .join("\n");
  return `[참고 설정 — 아래는 이 세계관의 공식 설정이다. 대화에 자연스럽게 반영하라]\n${body}`;
}

function mmdd(d: Date): string {
  const dt = new Date(d);
  return `${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * 호감도/유저 팩트/기억을 user 메시지 앞에 붙일 상태 블록으로 만든다.
 * 시스템 프롬프트는 캐싱 대상이라 매 턴 바뀌는 이 값은 user 메시지 쪽에 둔다. 비어 있는 섹션은 생략.
 */
export function formatStateBlock(s: {
  affinity: number;
  facts: string[];
  characterMemories: ChatMemory[];
  worldMemories: ChatMemory[];
}): string {
  const parts: string[] = [];
  if (s.facts.length > 0) {
    parts.push(`[유저에 대해 아는 것]\n${s.facts.map((f) => `- ${f}`).join("\n")}`);
  }
  // 호감도 0 이고 다른 정보도 없으면 의미 없는 블록이므로 생략
  if (s.affinity !== 0 || parts.length > 0 || s.characterMemories.length > 0 || s.worldMemories.length > 0) {
    parts.push(
      `[관계 상태] 호감도 ${s.affinity}/100 (-100 적대 ~ +100 깊은 유대). 말투와 태도에 자연스럽게 반영하라.`
    );
  }
  if (s.characterMemories.length > 0) {
    parts.push(
      `[둘 사이의 기억]\n${s.characterMemories.map((m) => `- ${mmdd(m.createdAt)}: ${m.summary}`).join("\n")}`
    );
  }
  if (s.worldMemories.length > 0) {
    parts.push(
      `[이 세계에서 유저에 대해 알려진 일] (직접 본 게 아니라면 소문/전언으로 들은 것처럼 다뤄라)\n${s.worldMemories.map((m) => `- ${mmdd(m.createdAt)}: ${m.summary}`).join("\n")}`
    );
  }
  return parts.join("\n");
}

const ANNIV_UPCOMING_DAYS = 7; // 며칠 전부터 예고할지
const ANNIV_DESC_MAX = 200;

/**
 * 오늘 기념일 / 앞으로 7일 이내 기념일을 user 메시지 앞에 붙일 블록으로 만든다.
 * 해당 없으면 빈 문자열. 연도 경계(12월 말 → 1월 초)를 처리한다.
 */
export function formatAnniversaryBlock(
  anniversaries: WorldAnniversary[] | undefined,
  today: Date = new Date()
): string {
  if (!anniversaries || anniversaries.length === 0) return "";
  const cut = (t: string) => (t.length > ANNIV_DESC_MAX ? `${t.slice(0, ANNIV_DESC_MAX)}…` : t);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const todayLines: string[] = [];
  const upcoming: { diff: number; line: string }[] = [];
  let hasPersonal = false;
  for (const a of anniversaries) {
    // 올해/내년 중 가장 가까운 미래(오늘 포함) 발생일 — 존재하지 않는 날짜(비윤년 2/29)는 건너뜀
    let diff: number | null = null;
    for (const y of [today.getFullYear(), today.getFullYear() + 1]) {
      const t = new Date(Date.UTC(y, a.month - 1, a.day));
      if (t.getUTCMonth() !== a.month - 1) continue;
      const d = Math.round((t.getTime() - todayUtc) / 86400000);
      if (d >= 0) {
        diff = d;
        break;
      }
    }
    if (diff == null) continue;
    const label = a.character_id != null ? `${a.name}(개인적인 날)` : a.name;
    if (diff === 0) {
      if (a.character_id != null) hasPersonal = true;
      todayLines.push(`[기념일] 오늘은 '${label}' — ${cut(a.description)}`);
    } else if (diff <= ANNIV_UPCOMING_DAYS) {
      if (a.character_id != null) hasPersonal = true;
      const md = `${String(a.month).padStart(2, "0")}-${String(a.day).padStart(2, "0")}`;
      upcoming.push({ diff, line: `[다가오는 기념일] ${diff}일 뒤(${md}) '${label}' — ${cut(a.description)}` });
    }
  }
  upcoming.sort((x, y) => x.diff - y.diff);
  const lines = [...todayLines, ...upcoming.map((u) => u.line)];
  if (lines.length > 0 && hasPersonal) {
    lines.push("(개인적인 날은 캐릭터가 홀로 마음에 담아 둔 날이다 — 상대가 모르는 것이 자연스럽다)");
  }
  return lines.join("\n");
}

/**
 * 응답 텍스트를 보고 노출할 일러스트를 고른다.
 * 1) conditional 일러스트 중 키워드가 매칭되는 것 우선
 * 2) 없으면 basic 일러스트 중 하나 (sort_order 우선, 간단한 로테이션)
 */
export function pickIllustration(
  illustrations: Illustration[],
  assistantText: string
): Illustration | null {
  for (const illust of illustrations) {
    if (illust.kind !== "conditional" || !illust.trigger_condition) continue;
    const { type, keywords } = illust.trigger_condition;
    if (type === "keyword" && keywords?.some((k) => k && assistantText.includes(k))) {
      return illust;
    }
  }
  const basics = illustrations
    .filter((i) => i.kind === "basic")
    .sort((a, b) => a.sort_order - b.sort_order);
  if (basics.length === 0) return null;
  // 응답 길이 기반의 단순 로테이션 (같은 기본 일러스트만 반복되지 않도록)
  return basics[assistantText.length % basics.length];
}
