import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  loadChatContext,
  loadRecentMessages,
  saveMessages,
  buildSystemPrompt,
  pickIllustration,
  getLlmSettings,
  getRagSettings,
  embedQuery,
  selectRelevantEntries,
  formatReferenceBlock,
  type ChatMessage,
} from "@vchatbot/core";
import { getOrCreateGuestUser } from "@/lib/user";

export const runtime = "nodejs";

const anthropic = new Anthropic();

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/chat  { characterId: number, message: string }
 * SSE 스트림 응답:
 *   {type:"text", delta:"..."}      토큰 단위 응답
 *   {type:"illustration", url, id}  노출할 일러스트 (있을 때)
 *   {type:"done"}                   완료
 *   {type:"error", message}         오류
 */
export async function POST(req: NextRequest) {
  const { characterId, message } = await req.json();
  if (!characterId || typeof message !== "string" || !message.trim()) {
    return Response.json({ error: "characterId, message 가 필요합니다." }, { status: 400 });
  }

  const userId = await getOrCreateGuestUser();
  const ctx = await loadChatContext(Number(characterId));
  if (!ctx) {
    return Response.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  }

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

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
    { role: "user", content: userContent },
  ];

  // 시스템 프롬프트는 캐릭터/세계관이 바뀌지 않는 한 동일 → 프롬프트 캐싱 대상
  const systemPrompt = buildSystemPrompt(ctx, { includeDictionary: !useRag });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sse(data)));
      try {
        const claudeStream = anthropic.messages.stream({
          model: llm.model,
          max_tokens: llm.maxTokens,
          output_config: { effort: "low" }, // 대화형 채팅은 저지연 우선
          system: [
            { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
          ],
          messages,
        });

        for await (const event of claudeStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "text", delta: event.delta.text });
          }
        }

        const final = await claudeStream.finalMessage();
        const assistantText = final.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

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
            meta: { model: final.model, stopReason: final.stop_reason },
            createdAt: new Date(now.getTime() + 1),
          },
        ];
        await saveMessages(toSave);
      } catch (err) {
        console.error("chat error:", err);
        const msg =
          err instanceof Anthropic.APIError
            ? `AI 호출 오류 (${err.status}): ${err.message}`
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
