import {
  loadChatContext,
  loadRecentMessages,
  saveMessages,
  buildSystemPrompt,
  OPENING_INSTRUCTION,
  pickIllustration,
  getLlmSettings,
  getRagSettings,
  embedQuery,
  selectRelevantEntries,
  formatReferenceBlock,
  execute,
  query,
  chargeChatWithFees,
  getChatCostForUser,
  getUserCharacterState,
  loadMemories,
  saveMemory,
  applyScoreResult,
  scoreExchange,
  getScoringSettings,
  formatStateBlock,
  formatAnniversaryBlock,
  formatTimeBlock,
  sanitizeUserMessage,
  invalidateCachePattern,
  generateGuestLine,
  recordUserActivity,
  evaluateTierPromotions,
  isCharacterHidden,
  getUserChatBlockMessage,
  getActiveEvent,
  maybeStartEvent,
  recordEventTurn,
  finishEvent,
  getAchievedEventIds,
  judgeEvent,
  formatEventBlock,
  setUserRelationship,
  type ActiveEventState,
  type GuestInfo,
  type LlmChatMessage,
  type ChatMessage,
  type ChatContext,
  type CharacterStateView,
} from "@vchatbot/core";
import type { LlmAdapter } from "@vchatbot/core";

/**
 * 채팅 한 턴의 LLM 호출 "이전" 단계 전부:
 * 컨텍스트/권한 검사 → 비용 → 이력 → RAG → 상태/기념일/시간 블록 → 메시지 조립 → 시스템 프롬프트.
 * /api/chat (서버 LLM)과 /api/chat/prepare (브라우저 LLM)가 공유한다.
 */
export interface PreparedTurn {
  ctx: ChatContext;
  chatCost: number;
  systemPrompt: string;
  messages: LlmChatMessage[];
  history: ChatMessage[];
  state: CharacterStateView;
  llm: Awaited<ReturnType<typeof getLlmSettings>>;
  /** 이번 턴에 진행/발동된 이벤트 (없으면 null) */
  event: ActiveEventState | null;
}

export type PrepareResult = { ok: true; turn: PreparedTurn } | { ok: false; status: number; error: string };

export interface PrepareOptions {
  /**
   * 브라우저 내장 LLM(Gemini Nano)용 컴팩트 모드: 입력 한도가 작으므로
   * 사전은 시스템 프롬프트에 넣지 않고 RAG 선별만 쓰며, 이력도 최근 일부만 보낸다.
   */
  compact?: boolean;
}

/** 컴팩트 모드에서 보낼 최근 이력 개수 */
const COMPACT_HISTORY = 12;

export async function prepareChatTurn(
  userId: number,
  characterId: number,
  message: string,
  opts: PrepareOptions = {}
): Promise<PrepareResult> {
  const ctx = await loadChatContext(Number(characterId));
  if (!ctx) return { ok: false, status: 404, error: "캐릭터를 찾을 수 없습니다." };

  // 사용중지된 캐릭터/세계관은 채팅 불가
  if (ctx.character.status === "suspended" || ctx.world.status === "suspended") {
    return { ok: false, status: 403, error: "사용이 중지된 캐릭터 또는 세계관입니다." };
  }
  // 삭제 대기 중이면 채팅 불가
  if (ctx.character.delete_scheduled_at || ctx.world.delete_scheduled_at) {
    return { ok: false, status: 403, error: "삭제 대기 중인 캐릭터 또는 세계관입니다." };
  }
  // 차단된 유저
  const userRows = await query<{ status: string }>("SELECT status FROM users WHERE id = ?", [userId]);
  if (userRows[0]?.status === "banned") {
    return { ok: false, status: 403, error: "이용이 제한된 계정입니다." };
  }
  const chatCost = await getChatCostForUser(userId);

  const llm = await getLlmSettings();
  const history = await loadRecentMessages(userId, ctx.character.id, llm.historyLimit);

  // 운영 제재(기간제 비공개) 캐릭터 — 기존 대화자는 계속 가능, 신규 대화 시작만 차단
  if (history.length === 0 && (await isCharacterHidden(ctx.character.id))) {
    return { ok: false, status: 403, error: "운영 제재로 신규 대화를 시작할 수 없는 캐릭터입니다." };
  }

  // 유저 기간제 제재 (모든 채팅 금지 / 첫 대화면 신규 채팅 금지도)
  const blockMsg = await getUserChatBlockMessage(userId, history.length === 0);
  if (blockMsg) return { ok: false, status: 403, error: blockMsg };
  // 컴팩트 모드: 프롬프트에 넣는 이력만 줄인다 (저장/채점용 history 는 전체 유지)
  const promptHistory = opts.compact ? history.slice(-COMPACT_HISTORY) : history;

  // 사전 RAG: 사전이 임계 글자수 이하면 전체 포함(기존 동작), 초과면 관련 항목만 사전 검색.
  // 컴팩트 모드는 사전이 있으면 무조건 RAG 선별만 사용 (시스템 프롬프트에 전체 사전 금지)
  const rag = await getRagSettings();
  const dictChars = ctx.dictionary.reduce((n, d) => n + d.title.length + d.content.length, 0);
  const useRag = opts.compact ? ctx.dictionary.length > 0 : dictChars > rag.thresholdChars;

  // LLM 에 보내는 쪽에만 인젝션 완화 정리를 적용 (Mongo 저장은 원본 message 유지)
  let userContent = sanitizeUserMessage(message);
  if (useRag) {
    const recent = history.slice(-2).map((m) => m.content);
    const queryText = [...recent, message].join("\n");
    let queryVec: number[] | null = null;
    try {
      queryVec = await embedQuery(queryText);
    } catch (err) {
      console.error("embedQuery 실패 — 키워드 매칭만 사용:", err);
    }
    const selected = selectRelevantEntries(ctx.dictionary, queryText, queryVec, {
      topK: opts.compact ? Math.min(rag.topK, 4) : rag.topK,
      minScore: rag.minScore,
    });
    if (selected.length > 0) userContent = `${formatReferenceBlock(selected)}\n\n${userContent}`;
  }

  // 호감도/유저 팩트/감정 기억을 user 메시지에 붙인다 (시스템 프롬프트 캐싱 유지를 위해)
  const state = await getUserCharacterState(userId, ctx.character.id);

  // 이벤트: 진행 중이면 유지, 없으면 발동 조건 검사 후 시작
  let activeEvent = await getActiveEvent(userId, ctx.character.id);
  if (!activeEvent) {
    activeEvent = await maybeStartEvent(
      userId,
      ctx.character.id,
      { affinity: state.affinity, relationship: state.relationship },
      message
    );
  }
  if (activeEvent) {
    userContent = `${formatEventBlock(activeEvent.event, activeEvent.justStarted)}\n\n${userContent}`;
  }
  const { characterMemories, worldMemories } = await loadMemories(userId, ctx.character.id, ctx.world.id);
  const stateBlock = formatStateBlock({
    affinity: state.affinity,
    facts: state.facts,
    characterMemories,
    worldMemories,
    relationship: state.relationship,
    callName: state.call_name,
  });
  // 기념일 블록: 상태 블록 → 기념일 블록 → RAG 참고 설정 → 원본 순
  const anniversaryBlock = formatAnniversaryBlock(ctx.anniversaries);
  if (anniversaryBlock) userContent = `${anniversaryBlock}\n\n${userContent}`;
  if (stateBlock) userContent = `${stateBlock}\n\n${userContent}`;
  // 시간 블록: 현재 시각/요일 + 마지막 대화 경과 (맨 앞)
  const lastMessageAt = history.length > 0 ? history[history.length - 1].createdAt : null;
  userContent = `${formatTimeBlock(new Date(), lastMessageAt)}\n\n${userContent}`;

  // 오프닝(assistant)으로 이력이 시작되면 저장하지 않은 지시문을 앞에 붙여 user 로 시작하게 한다
  const openingHead: LlmChatMessage[] =
    promptHistory[0]?.role === "assistant" ? [{ role: "user", content: OPENING_INSTRUCTION }] : [];
  const messages = ([
    ...openingHead,
    ...promptHistory.map((m): LlmChatMessage => ({
      role: m.role,
      // 게스트 발화는 모델이 제3자 발언으로 인식하도록 이름 태그를 붙인다. 과거 유저 발화도 정리해서 보낸다
      content:
        typeof m.meta?.guest === "string"
          ? `[${m.meta.guest}] ${m.content}`
          : m.role === "user"
            ? sanitizeUserMessage(m.content)
            : m.content,
    })),
    { role: "user", content: userContent },
  ] as LlmChatMessage[]).reduce<LlmChatMessage[]>((acc, m) => {
    // 게스트 메시지가 assistant 연속을 만들 수 있으므로 같은 role 은 하나로 합친다
    const prev = acc[acc.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n\n${m.content}`;
    else acc.push({ ...m });
    return acc;
  }, []);

  // 시스템 프롬프트는 캐릭터/세계관이 바뀌지 않는 한 동일 → 프롬프트 캐싱 대상
  const systemPrompt = buildSystemPrompt(ctx, { includeDictionary: !useRag });

  return { ok: true, turn: { ctx, chatCost, systemPrompt, messages, history, state, llm, event: activeEvent } };
}

/**
 * 채팅 한 턴의 LLM 응답 "이후" 단계 전부:
 * 과금+수수료(coin) → 채점/기억(affinity) → 게스트 → 일러스트 → done → 저장 → 인기 집계.
 * SSE 이벤트는 send 콜백으로 내보낸다. /api/chat 과 /api/chat/complete 가 공유한다.
 */
export interface FinishParams {
  userId: number;
  ctx: ChatContext;
  history: ChatMessage[];
  state: CharacterStateView;
  /** 원본 유저 메시지 (저장용). opening 이면 빈 문자열 */
  message: string;
  assistantText: string;
  chatCost: number;
  /** 게스트 대사 생성에 쓸 어댑터. null 이면 게스트 난입 스킵 (브라우저 LLM 경로) */
  adapter: LlmAdapter | null;
  /** assistant 메시지 meta 에 합칠 추가 필드 (model, providerId 등) */
  assistantMeta: Record<string, unknown>;
  /** 이번 턴 토큰 사용량 (활동 집계용). 브라우저 생성은 null */
  usage?: { inputTokens?: number; outputTokens?: number } | null;
  /** 이번 턴에 진행된 이벤트 (prepare 가 발동/유지한 것) */
  event?: ActiveEventState | null;
  /** 오프닝 모드: user 메시지 저장/채점 없이 assistant 만 저장, memo '오프닝 생성' */
  opening?: boolean;
}

export async function finishChatTurn(send: (data: unknown) => void, p: FinishParams): Promise<void> {
  const { userId, ctx, history, state, message, assistantText, chatCost } = p;

  // 과금 + 수수료 분배. 실패해도 이미 전송된 응답은 유지
  let creatorFee = 0;
  let worldFee = 0;
  try {
    const charged = await chargeChatWithFees(
      userId,
      chatCost,
      {
        characterId: ctx.character.id,
        characterOwnerId: ctx.character.owner_user_id,
        worldId: ctx.world.id,
        worldOwnerId: ctx.world.owner_user_id,
      },
      p.opening ? "오프닝 생성" : undefined
    );
    creatorFee = charged.creatorFee;
    worldFee = charged.worldFee;
    send({ type: "coin", cost: chatCost, balance: charged.balance });
  } catch (feeErr) {
    console.error("coin charge error:", feeErr);
  }

  // 호감도 채점 + 감정 기억 저장 (실패/타임아웃 시 건너뜀). 오프닝은 채점 없음
  let affinityDelta: number | undefined;
  let emotion: string | null = null;
  let guest: { name: string; entryId: number; text: string } | null = null;
  if (!p.opening) {
    try {
      const scoring = await getScoringSettings();
      if (scoring.enabled) {
        // 게스트 후보: 공통 person 사전 항목 + 관계 대상 (현재 캐릭터 제외, 중복 제거, 최대 30개)
        const candidateSet = new Set<string>();
        if (scoring.guestEnabled && p.adapter) {
          for (const d of ctx.dictionary) {
            if (d.category === "person" && d.character_id == null) candidateSet.add(d.title);
          }
          for (const r of ctx.relationships) {
            if (r.target_title) candidateSet.add(r.target_title);
          }
          candidateSet.delete(ctx.character.name);
        }
        const guestCandidates = [...candidateSet].slice(0, 30);
        const timeout = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`채점 타임아웃(${scoring.timeoutMs / 1000}초)`)), scoring.timeoutMs)
        );
        const score = await Promise.race([
          scoreExchange({
            characterName: ctx.character.name,
            worldName: ctx.world.name,
            userMessage: message,
            assistantMessage: assistantText,
            currentAffinity: state.affinity,
            currentFacts: state.facts,
            guestCandidates,
            scenario: ctx.character.scenario,
          }),
          timeout,
        ]);
        const affinity = await applyScoreResult(userId, ctx.character.id, score);
        if (score.emotionalEvent) {
          const ev = score.emotionalEvent;
          await saveMemory({
            userId,
            characterId: ev.scope === "character" ? ctx.character.id : null,
            worldId: ctx.world.id,
            scope: ev.scope,
            summary: ev.summary,
            situation: ev.situation || null,
            affinityDelta: score.affinityDelta,
            createdAt: new Date(),
          });
        }
        affinityDelta = score.affinityDelta;
        send({ type: "affinity", value: affinity, delta: score.affinityDelta });
        // 감정 → 프로필 이미지 교체용 (클라이언트가 감정별 프로필을 들고 있음)
        if (score.emotion) {
          emotion = score.emotion;
          send({ type: "emotion", emotion: score.emotion });
        }

        // 게스트 난입: 가드(설정 + 최근 guestMinGap 개 assistant 메시지에 게스트 없음) → 이름 해석 → 대사 생성
        // 플랫폼 연출이므로 코인 차감 없음. 실패 시 조용히 스킵
        const ga = score.guestAppearance;
        if (ga && scoring.guestEnabled && p.adapter && candidateSet.has(ga.name)) {
          try {
            const recentAssistants = history.filter((m) => m.role === "assistant").slice(-scoring.guestMinGap);
            const recentGuest = recentAssistants.some((m) => m.meta?.guest);
            const entry = ctx.dictionary.find(
              (d) => d.category === "person" && d.character_id == null && d.title === ga.name
            );
            if (!recentGuest && entry) {
              let persona: GuestInfo["persona"] = null;
              if (entry.linked_character_id) {
                const rows = await query<{ profile: string; personality: string; speech_style: string }>(
                  "SELECT profile, personality, speech_style FROM characters WHERE id = ? AND is_active = 1",
                  [entry.linked_character_id]
                );
                persona = rows[0] ?? null;
              }
              const recentDialogue = [
                ...history.slice(-4).map((m) => `${m.role === "user" ? "유저" : ctx.character.name}: ${m.content}`),
                `유저: ${message}`,
                `${ctx.character.name}: ${assistantText}`,
              ].join("\n");
              const text = await generateGuestLine({
                adapter: p.adapter,
                worldName: ctx.world.name,
                hostName: ctx.character.name,
                guest: { entryId: entry.id, name: entry.title, content: entry.content, persona },
                recentDialogue,
                lineHint: ga.line_hint,
                scenario: ctx.character.scenario,
              });
              guest = { name: entry.title, entryId: entry.id, text };
            }
          } catch (guestErr) {
            console.error("guest error:", guestErr);
          }
        }
      }
    } catch (scoreErr) {
      console.error("scoring error:", scoreErr);
    }
  }

  // 이벤트 판정: 턴 집계 → 채점 LLM 판정 → 턴 초과 시 실패. 오프닝 턴은 제외
  let eventResult: { status: "success" | "failed"; name: string; retryHours?: number } | null = null;
  if (p.event && !p.opening) {
    try {
      const ev = p.event.event;
      const turns = await recordEventTurn(p.event.uceId);
      const recentDialogue = [
        ...history.slice(-6).map((m) => `${m.role === "user" ? "유저" : ctx.character.name}: ${m.content}`),
        `유저: ${message}`,
        `${ctx.character.name}: ${assistantText}`,
      ].join("\n");
      let verdict = await judgeEvent({ event: ev, recentDialogue });
      if (verdict === "ongoing" && turns >= ev.max_turns) verdict = "fail";
      if (verdict === "success") {
        await finishEvent(p.event.uceId, "success");
        if (ev.set_relationship) {
          await setUserRelationship(userId, ctx.character.id, ev.set_relationship);
        }
        await execute(
          "INSERT INTO user_notifications (user_id, type, title, body) VALUES (?, 'event', ?, ?)",
          [userId, `이벤트 성공 — ${ev.name}`, ev.situation.slice(0, 200)]
        );
        eventResult = { status: "success", name: ev.name };
      } else if (verdict === "fail") {
        await finishEvent(p.event.uceId, "failed");
        eventResult = { status: "failed", name: ev.name, retryHours: ev.retry_hours };
      }
      if (eventResult) send({ type: "event", ...eventResult });
    } catch (e) {
      console.error("event judge error:", e);
    }
  }

  // 활동 집계 + 등급 자동 승급 (실패해도 채팅은 계속). 승급 시 SSE 토스트
  try {
    await recordUserActivity(userId, {
      messages: p.opening ? 0 : 1,
      tokens: (Number(p.usage?.inputTokens) || 0) + (Number(p.usage?.outputTokens) || 0),
    });
    const promotions = await evaluateTierPromotions(userId);
    for (const promo of promotions) {
      send({ type: "tier", track: promo.track, name: promo.name, direction: promo.direction });
    }
  } catch (e) {
    console.error("tier evaluation error:", e);
  }

  // 응답 내용 기반 일러스트 선택 (이벤트 달성 조건 → 조건부 키워드 매칭 → 기본 로테이션)
  let achievedEvents: Set<number> | undefined;
  try {
    achievedEvents = await getAchievedEventIds(userId, ctx.character.id);
  } catch {
    achievedEvents = undefined;
  }
  const illustration = pickIllustration(ctx.illustrations, assistantText, achievedEvents);
  if (illustration) {
    send({
      type: "illustration",
      id: illustration.id,
      url: illustration.url,
      kind: illustration.kind,
    });
  }
  if (guest) send({ type: "guest", name: guest.name, text: guest.text });
  send({ type: "done" });

  // 대화 저장
  const now = new Date();
  const toSave: ChatMessage[] = [];
  if (!p.opening) {
    toSave.push({
      userId,
      characterId: ctx.character.id,
      role: "user",
      content: message,
      createdAt: now,
    });
  }
  toSave.push({
    userId,
    characterId: ctx.character.id,
    role: "assistant",
    content: assistantText,
    illustrationId: illustration?.id,
    meta: {
      ...p.assistantMeta,
      cost: chatCost,
      creatorFee,
      worldFee,
      ...(affinityDelta !== undefined ? { affinityDelta } : {}),
      ...(emotion ? { emotion } : {}),
      ...(eventResult ? { event: { name: eventResult.name, status: eventResult.status } } : {}),
    },
    createdAt: new Date(now.getTime() + 1),
  });
  if (guest) {
    toSave.push({
      userId,
      characterId: ctx.character.id,
      role: "assistant",
      content: guest.text,
      meta: { guest: guest.name, guestEntryId: guest.entryId },
      createdAt: new Date(now.getTime() + 2),
    });
  }
  await saveMessages(toSave);
  // 인기순 집계 (캐릭터 목록 캐시는 영구라 카운트 변경 시 직접 무효화)
  await execute("UPDATE characters SET chat_count = chat_count + 1 WHERE id = ?", [ctx.character.id]);
  await invalidateCachePattern("cache:web:chars:*");
}
