import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  loadChatContext,
  loadRecentMessages,
  saveMessages,
  buildSystemPrompt,
  OPENING_INSTRUCTION,
  pickIllustration,
  getLlmSettings,
  resolveLlmForUser,
  createAdapter,
  type LlmChatMessage,
  getRagSettings,
  embedQuery,
  selectRelevantEntries,
  formatReferenceBlock,
  execute,
  query,
  chargeChatWithFees,
  getChatCostForUser,
  type ChatMessage,
  getUserCharacterState,
  loadMemories,
  saveMemory,
  applyScoreResult,
  scoreExchange,
  getScoringSettings,
  formatStateBlock,
  formatAnniversaryBlock,
  invalidateCachePattern,
  generateGuestLine,
  type GuestInfo,
} from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/chat  { characterId: number, message: string }
 * SSE 스트림 응답:
 *   {type:"text", delta:"..."}      토큰 단위 응답
 *   {type:"illustration", url, id}  노출할 일러스트 (있을 때)
 *   {type:"affinity", value, delta} 채점 후 호감도 및 변화량 (채점 성공 시)
 *   {type:"guest", name, text}      게스트 난입 대사 (드물게, done 직전)
 *   {type:"coin", cost, balance}    차감 코인 및 잔액 (done 직전)
 *   {type:"done"}                   완료
 *   {type:"error", message}         오류
 */
export async function POST(req: NextRequest) {
  const { characterId, message } = await req.json();
  if (!characterId || typeof message !== "string" || !message.trim()) {
    return Response.json({ error: "characterId, message 가 필요합니다." }, { status: 400 });
  }

  const userId = await getUserId();
  if (!userId) return Response.json({ error: "login_required" }, { status: 401 });
  const ctx = await loadChatContext(Number(characterId));
  if (!ctx) {
    return Response.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  }

  // 사용중지된 캐릭터/세계관은 채팅 불가
  if (ctx.character.status === "suspended" || ctx.world.status === "suspended") {
    return Response.json({ error: "사용이 중지된 캐릭터 또는 세계관입니다." }, { status: 403 });
  }
  // 차단된 유저
  const userRows = await query<{ status: string }>("SELECT status FROM users WHERE id = ?", [userId]);
  if (userRows[0]?.status === "banned") {
    return Response.json({ error: "이용이 제한된 계정입니다." }, { status: 403 });
  }
  const chatCost = await getChatCostForUser(userId);

  const llm = await getLlmSettings();
  const history = await loadRecentMessages(userId, ctx.character.id, llm.historyLimit);

  // 사전 RAG: 사전이 임계 글자수 이하면 전체 포함(기존 동작), 초과면 관련 항목만 사전 검색
  const rag = await getRagSettings();
  const dictChars = ctx.dictionary.reduce((n, d) => n + d.title.length + d.content.length, 0);
  const useRag = dictChars > rag.thresholdChars;

  let userContent = message;
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
      topK: rag.topK,
      minScore: rag.minScore,
    });
    // Claude 에만 참고 블록을 붙인다. Mongo 저장(toSave)은 원본 message 유지
    if (selected.length > 0) userContent = `${formatReferenceBlock(selected)}\n\n${message}`;
  }

  // 호감도/유저 팩트/감정 기억을 user 메시지에 붙인다 (시스템 프롬프트 캐싱 유지를 위해)
  const state = await getUserCharacterState(userId, ctx.character.id);
  const { characterMemories, worldMemories } = await loadMemories(userId, ctx.character.id, ctx.world.id);
  const stateBlock = formatStateBlock({ affinity: state.affinity, facts: state.facts, characterMemories, worldMemories });
  // 기념일(당일/7일 전부터) 블록: 상태 블록 → 기념일 블록 → RAG 참고 설정 → 원본 순
  const anniversaryBlock = formatAnniversaryBlock(ctx.anniversaries);
  if (anniversaryBlock) userContent = `${anniversaryBlock}\n\n${userContent}`;
  if (stateBlock) userContent =`${stateBlock}\n\n${userContent}`;

  // 오프닝(assistant)으로 이력이 시작되면 저장하지 않은 지시문을 앞에 붙여 user 로 시작하게 한다
  const openingHead: LlmChatMessage[] =
    history[0]?.role === "assistant" ? [{ role: "user", content: OPENING_INSTRUCTION }] : [];
  const messages = ([
    ...openingHead,
    ...history.map((m): LlmChatMessage => ({
      role: m.role,
      // 게스트 발화는 모델이 제3자 발언으로 인식하도록 이름 태그를 붙인다
      content: typeof m.meta?.guest === "string" ? `[${m.meta.guest}] ${m.content}` : m.content,
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sse(data)));
      try {
        // 유저 등급에 할당된 LLM 선택 (없으면 env/기본 설정 폴백)
        const { provider } = await resolveLlmForUser(userId);
        const adapter = await createAdapter(provider);
        const llmStream = adapter.streamChat({
          system: systemPrompt,
          messages,
          maxTokens: provider ? provider.max_tokens : llm.maxTokens,
        });

        let assistantText = "";
        for await (const delta of llmStream.deltas) {
          assistantText += delta;
          send({ type: "text", delta });
        }
        const outcome = llmStream.outcome();

        // 과금 + 수수료 분배 (스트림 완료 후). 실패해도 이미 전송된 응답은 유지
        let creatorFee = 0;
        let worldFee = 0;
        try {
          const charged = await chargeChatWithFees(userId, chatCost, {
            characterId: ctx.character.id,
            characterOwnerId: ctx.character.owner_user_id,
            worldId: ctx.world.id,
            worldOwnerId: ctx.world.owner_user_id,
          });
          const balance = charged.balance;
          creatorFee = charged.creatorFee;
          worldFee = charged.worldFee;
          send({ type: "coin", cost: chatCost, balance });
        } catch (feeErr) {
          console.error("coin charge error:", feeErr);
        }

        // 호감도 채점 + 감정 기억 저장 (실패/타임아웃 시 건너뜀)
        let affinityDelta: number | undefined;
        // 게스트 난입 결과 (일러스트 전송 후 SSE 로 내보낸다 — 일러스트가 본 응답 말풍선에 붙도록)
        let guest: { name: string; entryId: number; text: string } | null = null;
        try {
          const scoring = await getScoringSettings();
          if (scoring.enabled) {
            // 게스트 후보: 공통 person 사전 항목 + 관계 대상 (현재 캐릭터 제외, 중복 제거, 최대 30개)
            const candidateSet = new Set<string>();
            if (scoring.guestEnabled) {
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
              setTimeout(() => rej(new Error("채점 타임아웃(10초)")), 10_000)
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

            // 게스트 난입: 가드(설정 + 최근 guestMinGap 개 assistant 메시지에 게스트 없음) → 이름 해석 → 대사 생성
            // 플랫폼 연출이므로 코인 차감 없음. 실패 시 조용히 스킵
            const ga = score.guestAppearance;
            if (ga && scoring.guestEnabled && candidateSet.has(ga.name)) {
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
                    adapter,
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

        // 응답 내용 기반 일러스트 선택 (조건부 키워드 매칭 → 기본 로테이션)
        const illustration = pickIllustration(ctx.illustrations, assistantText);
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
        controller.close();

        // 대화 저장 (스트림 종료 후)
        const now = new Date();
        const toSave: ChatMessage[] = [
          {
            userId,
            characterId: ctx.character.id,
            role: "user",
            content: message,
            createdAt: now,
          },
          {
            userId,
            characterId: ctx.character.id,
            role: "assistant",
            content: assistantText,
            illustrationId: illustration?.id,
            meta: {
              model: outcome.model,
              stopReason: outcome.stopReason,
              providerId: provider?.id ?? null,
              providerName: provider?.name ?? "env-fallback",
              cost: chatCost,
              creatorFee,
              worldFee,
              tokensIn: outcome.usage?.inputTokens,
              tokensOut: outcome.usage?.outputTokens,
              tokensCacheRead: outcome.usage?.cacheReadTokens,
              affinityDelta,
            },
            createdAt: new Date(now.getTime() + 1),
          },
        ];
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
      } catch (err) {
        console.error("chat error:", err);
        const msg =
          err instanceof Anthropic.APIError
            ? `AI 호출 오류 (${err.status}): ${err.message}`
            : err instanceof Error
              ? `AI 호출 오류: ${err.message}`
              : "응답 생성 중 오류가 발생했습니다.";
        try {
          send({ type: "error", message: msg });
          controller.close();
        } catch {
          // 이미 닫힌 경우 무시
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
