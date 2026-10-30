import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  resolveLlmForUser,
  resolveAiLevelForUser,
  createAdapter,
  recordLlmUsage,
} from "@vchatbot/core";
import { getUserId } from "@/lib/user";
import { prepareChatTurn, finishChatTurn } from "@/lib/chat-pipeline";

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
 *
 * 유저의 AI 레벨이 browser(크롬 내장 AI)면 409 — 클라이언트가
 * /api/chat/prepare → (브라우저 생성) → /api/chat/complete 경로를 쓴다.
 */
export async function POST(req: NextRequest) {
  const { characterId, message } = await req.json();
  if (!characterId || typeof message !== "string" || !message.trim()) {
    return Response.json({ error: "characterId, message 가 필요합니다." }, { status: 400 });
  }

  const userId = await getUserId();
  if (!userId) return Response.json({ error: "login_required" }, { status: 401 });

  // 브라우저 AI 레벨 유저는 서버 LLM 경로를 쓰지 않는다 (과금 체계가 다름)
  const level = await resolveAiLevelForUser(userId);
  if (level?.kind === "browser") {
    return Response.json({ error: "browser_level" }, { status: 409 });
  }

  const prepared = await prepareChatTurn(userId, Number(characterId), message);
  if (!prepared.ok) {
    return Response.json({ error: prepared.error }, { status: prepared.status });
  }
  const { ctx, chatCost, systemPrompt, messages, history, state, llm } = prepared.turn;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sse(data)));
      try {
        // AI 레벨/등급에 할당된 LLM 선택 (없으면 env/기본 설정 폴백)
        const { provider, account } = await resolveLlmForUser(userId);
        const adapter = await createAdapter(provider, account);
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
        if (outcome.usage) {
          await recordLlmUsage(provider?.id ?? null, account?.id ?? null, outcome.usage);
        }

        await finishChatTurn(send, {
          userId,
          ctx,
          history,
          state,
          message,
          assistantText,
          chatCost,
          adapter,
          assistantMeta: {
            model: outcome.model,
            stopReason: outcome.stopReason,
            providerId: provider?.id ?? null,
            providerName: provider?.name ?? "env-fallback",
            tokensIn: outcome.usage?.inputTokens,
            tokensOut: outcome.usage?.outputTokens,
            tokensCacheRead: outcome.usage?.cacheReadTokens,
          },
          usage: outcome.usage ?? null,
          event: prepared.turn.event,
        });
        controller.close();
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
