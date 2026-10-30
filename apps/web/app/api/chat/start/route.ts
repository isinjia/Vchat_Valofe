import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  loadChatContext,
  loadRecentMessages,
  saveMessages,
  buildSystemPrompt,
  OPENING_INSTRUCTION,
  formatTimeBlock,
  pickIllustration,
  getLlmSettings,
  resolveLlmForUser,
  resolveAiLevelForUser,
  createAdapter,
  recordLlmUsage,
  isCharacterHidden,
  getUserChatBlockMessage,
  getUserTierRankInfo,
  type LlmChatMessage,
  getRagSettings,
  chargeChatWithFees,
  getChatCostForUser,
  execute,
  query,
  invalidateCachePattern,
  type ChatMessage,
} from "@vchatbot/core";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";

/** 동시 호출 가드 (StrictMode/다중 탭 중복 생성·중복 과금 방지) key: userId:characterId */
const inflight = new Set<string>();

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/chat/start  { characterId: number }
 * 채팅 오프닝. 이력이 있거나 이미 진행 중이면 JSON {started:false}.
 * 이력이 없으면 /api/chat 과 같은 형식의 SSE 스트림:
 *   - greeting 있음: 제작자 인사말 그대로 (AI 호출/과금 없음)
 *   - greeting 없음: AI 가 첫 대사 생성 (채팅 1회 비용 과금 + 수수료 분배)
 */
export async function POST(req: NextRequest) {
  const { characterId } = await req.json().catch(() => ({}));
  if (!characterId) {
    return Response.json({ error: "characterId 가 필요합니다." }, { status: 400 });
  }

  const userId = await getUserId();
  if (!userId) return Response.json({ error: "login_required" }, { status: 401 });
  const ctx = await loadChatContext(Number(characterId));
  if (!ctx) {
    return Response.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  }
  if (ctx.character.status === "suspended" || ctx.world.status === "suspended") {
    return Response.json({ error: "사용이 중지된 캐릭터 또는 세계관입니다." }, { status: 403 });
  }
  if (ctx.character.delete_scheduled_at || ctx.world.delete_scheduled_at) {
    return Response.json({ error: "삭제 대기 중인 캐릭터 또는 세계관입니다." }, { status: 403 });
  }
  // 오프닝은 신규 대화 — 제재(기간제 비공개) 캐릭터는 시작 불가 (기존 대화자는 /api/chat 로 계속 가능)
  if (await isCharacterHidden(ctx.character.id)) {
    return Response.json({ error: "운영 제재로 신규 대화를 시작할 수 없는 캐릭터입니다." }, { status: 403 });
  }
  const userRows = await query<{ status: string }>("SELECT status FROM users WHERE id = ?", [userId]);
  if (userRows[0]?.status === "banned") {
    return Response.json({ error: "이용이 제한된 계정입니다." }, { status: 403 });
  }
  // 오프닝은 항상 신규 대화 — 유저 기간제 제재(전체/신규) 모두 차단
  const blockMsg = await getUserChatBlockMessage(userId, true);
  if (blockMsg) return Response.json({ error: blockMsg }, { status: 403 });

  // 이미 대화 이력이 있으면 오프닝 불필요
  const existing = await loadRecentMessages(userId, ctx.character.id, 1);
  if (existing.length > 0) return Response.json({ started: false });

  // 브라우저 AI 레벨 유저 + 제작자 인사말 없음 → 서버 LLM 대신 브라우저 생성 경로로 안내
  const greetingText = ctx.character.greeting?.trim() ?? "";
  if (!greetingText) {
    const level = await resolveAiLevelForUser(userId);
    if (level?.kind === "browser") {
      return Response.json({ started: false, browserOpening: true });
    }
  }

  const key = `${userId}:${ctx.character.id}`;
  if (inflight.has(key)) return Response.json({ started: false });
  inflight.add(key);

  const greeting = ctx.character.greeting?.trim() ?? "";
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sse(data)));
      try {
        let assistantText = "";
        let meta: Record<string, unknown>;

        if (greeting) {
          // 제작자 인사말: AI 호출/과금 없음
          assistantText = greeting;
          send({ type: "text", delta: greeting });
          meta = { opening: "greeting" };
        } else {
          const chatCost = await getChatCostForUser(userId);
          const llm = await getLlmSettings();
          // 오프닝에는 사전 전체 포함 여부를 RAG 임계값 기준으로 결정 (검색 쿼리가 없으므로 초과 시 사전 생략)
          const rag = await getRagSettings();
          const dictChars = ctx.dictionary.reduce((n, d) => n + d.title.length + d.content.length, 0);
          const systemPrompt = buildSystemPrompt(ctx, { includeDictionary: dictChars <= rag.thresholdChars });
          // 시간 블록을 함께 줘서 오프닝이 아침/밤 같은 시간대에 어울리게 한다
          const messages: LlmChatMessage[] = [
            { role: "user", content: `${formatTimeBlock(new Date(), null)}\n\n${OPENING_INSTRUCTION}` },
          ];

          const { provider, account } = await resolveLlmForUser(userId);
          const adapter = await createAdapter(provider, account);
          const llmStream = adapter.streamChat({
            system: systemPrompt,
            messages,
            maxTokens: provider ? provider.max_tokens : llm.maxTokens,
          });
          for await (const delta of llmStream.deltas) {
            assistantText += delta;
            send({ type: "text", delta });
          }
          const outcome = llmStream.outcome();
          if (outcome.usage) {
            await recordLlmUsage(provider?.id ?? null, account?.id ?? null, outcome.usage);
          }

          // 과금 + 수수료 분배 (실패해도 이미 전송된 응답은 유지)
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
              "오프닝 생성"
            );
            creatorFee = charged.creatorFee;
            worldFee = charged.worldFee;
            send({ type: "coin", cost: chatCost, balance: charged.balance });
          } catch (feeErr) {
            console.error("opening coin charge error:", feeErr);
          }
          meta = {
            opening: "generated",
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
          };
        }

        // 오프닝은 첫 대화라 호감도/관계/이벤트가 초기값 — 등급 게이트만 실제 평가
        let illustration = null;
        try {
          const tierInfo = await getUserTierRankInfo(userId);
          illustration = pickIllustration(ctx.illustrations, assistantText, {
            userTierRank: tierInfo.userTierRank,
            tierRankById: tierInfo.tierRankById,
          });
        } catch {
          illustration = pickIllustration(ctx.illustrations, assistantText);
        }
        if (illustration) {
          send({
            type: "illustration",
            id: illustration.id,
            url: illustration.url,
            kind: illustration.kind,
          });
        }
        send({ type: "done" });
        controller.close();

        // assistant 메시지만 저장 (유저 지시문은 저장하지 않음)
        const toSave: ChatMessage[] = [
          {
            userId,
            characterId: ctx.character.id,
            role: "assistant",
            content: assistantText,
            illustrationId: illustration?.id,
            meta,
            createdAt: new Date(),
          },
        ];
        await saveMessages(toSave);
        // 인기순 집계 (AI 생성 오프닝만 — 제작자 인사말은 대화 수에 넣지 않음)
        if (!greeting) {
          await execute("UPDATE characters SET chat_count = chat_count + 1 WHERE id = ?", [ctx.character.id]);
          await invalidateCachePattern("cache:web:chars:*");
        }
      } catch (err) {
        console.error("chat start error:", err);
        const msg =
          err instanceof Anthropic.APIError
            ? `AI 호출 오류 (${err.status}): ${err.message}`
            : err instanceof Error
              ? `AI 호출 오류: ${err.message}`
              : "오프닝 생성 중 오류가 발생했습니다.";
        try {
          send({ type: "error", message: msg });
          controller.close();
        } catch {
          // 이미 닫힌 경우 무시
        }
      } finally {
        inflight.delete(key);
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
