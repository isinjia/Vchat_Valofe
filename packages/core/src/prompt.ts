import type {
  CharacterPersona,
  CharacterRelationship,
  DictionaryEntry,
  Illustration,
  World,
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
    const body = relationships
      .map((r) => `- ${r.target_name ?? `캐릭터#${r.target_character_id}`}: ${r.relation}`)
      .join("\n");
    parts.push(`# 다른 캐릭터와의 관계\n${body}`);
  }

  if (character.ai_prompt.trim()) {
    parts.push(`# 캐릭터 상세 지침\n${character.ai_prompt}`);
  }

  return parts.join("\n\n");
}

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
