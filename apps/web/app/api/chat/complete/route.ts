import { NextRequest } from "next/server";
import {
  loadChatContext,
  loadRecentMessages,
  getLlmSettings,
  getChatCostForUser,
  getUserCharacterState,
  resolveAiLevelForUser,
  isCharacterHidden,
  getUserChatBlockMessage,
  getActiveEvent,
  query,
} from "@vchatbot/core";
import { getUserId } from "@/lib/user";
import { finishChatTurn } from "@/lib/chat-pipeline";

export const runtime = "nodejs";

/** 브라우저 생성 결과 반납의 동시 호출 가드 (오프닝 중복 저장 방지) key: userId:characterId */
const inflight = new Set<string>();

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/chat/complete  { characterId, message?, assistantText, opening? }
 * 브라우저 AI 레벨 전용: 클라이언트가 크롬 내장 LLM 으로 생성한 응답을 반납하면
 * 서버가 과금/채점/일러스트/저장을 수행한다. 응답은 /api/chat 과 같은 SSE
 * (text 델타만 없음: coin/affinity/illustration/done).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const characterId = Number(body.characterId);
  const opening = body.opening === true;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const assistantText = typeof body.assistantText === "string" ? body.assistantText.trim().slice(0, 20000) : "";
  if (!characterId || !assistantText || (!opening && !message)) {
    return Response.json({ error: "characterId, assistantText(, message) 가 필요합니다." }, { status: 400 });
  }

  const userId = await getUserId();
  if (!userId) return Response.json({ error: "login_required" }, { status: 401 });

  const level = await resolveAiLevelForUser(userId);
  if (level?.kind !== "browser") {
    return Response.json({ error: "브라우저 AI 레벨에서만 사용할 수 있습니다." }, { status: 403 });
  }

  const ctx = await loadChatContext(characterId);
  if (!ctx) return Response.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  if (ctx.character.status === "suspended" || ctx.world.status === "suspended") {
    return Response.json({ error: "사용이 중지된 캐릭터 또는 세계관입니다." }, { status: 403 });
  }
  if (ctx.character.delete_scheduled_at || ctx.world.delete_scheduled_at) {
    return Response.json({ error: "삭제 대기 중인 캐릭터 또는 세계관입니다." }, { status: 403 });
  }
  const userRows = await query<{ status: string }>("SELECT status FROM users WHERE id = ?", [userId]);
  if (userRows[0]?.status === "banned") {
    return Response.json({ error: "이용이 제한된 계정입니다." }, { status: 403 });
  }
  const blockMsg = await getUserChatBlockMessage(userId, opening);
  if (blockMsg) return Response.json({ error: blockMsg }, { status: 403 });

  if (opening) {
    const existing = await loadRecentMessages(userId, characterId, 1);
    if (existing.length > 0) return Response.json({ error: "이미 대화가 시작되었습니다." }, { status: 409 });
  }

  const key = `${userId}:${characterId}`;
  if (inflight.has(key)) return Response.json({ error: "처리 중입니다." }, { status: 429 });
  inflight.add(key);

  const [chatCost, llm, state] = await Promise.all([
    getChatCostForUser(userId),
    getLlmSettings(),
    getUserCharacterState(userId, characterId),
  ]);
  const history = await loadRecentMessages(userId, characterId, llm.historyLimit);
  // prepare 가 발동/유지한 이벤트 (브라우저 생성 경로에서도 판정은 서버가 한다)
  const activeEvent = opening ? null : await getActiveEvent(userId, characterId);

  // 운영 제재(기간제 비공개) 캐릭터 — 기존 대화자는 계속 가능, 신규 대화 시작만 차단
  if ((opening || history.length === 0) && (await isCharacterHidden(characterId))) {
    inflight.delete(key);
    return Response.json({ error: "운영 제재로 신규 대화를 시작할 수 없는 캐릭터입니다." }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sse(data)));
      try {
        await finishChatTurn(send, {
          userId,
          ctx,
          history,
          state,
          message,
          assistantText,
          chatCost,
          adapter: null, // 게스트 대사는 서버 LLM 이 필요하므로 브라우저 경로에서는 스킵
          assistantMeta: {
            model: "browser",
            providerName: "chrome-builtin",
            ...(opening ? { opening: "generated-browser" } : {}),
          },
          event: activeEvent,
          opening,
        });
        controller.close();
      } catch (err) {
        console.error("chat complete error:", err);
        try {
          send({ type: "error", message: "응답 저장 중 오류가 발생했습니다." });
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
