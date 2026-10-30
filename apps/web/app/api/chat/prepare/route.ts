import { NextRequest, NextResponse } from "next/server";
import {
  loadChatContext,
  loadRecentMessages,
  buildSystemPrompt,
  OPENING_INSTRUCTION,
  formatTimeBlock,
  getLlmSettings,
  getChatCostForUser,
  resolveAiLevelForUser,
  isCharacterHidden,
  getUserChatBlockMessage,
  query,
  type LlmChatMessage,
} from "@vchatbot/core";
import { getUserId } from "@/lib/user";
import { prepareChatTurn } from "@/lib/chat-pipeline";

export const runtime = "nodejs";

/**
 * POST /api/chat/prepare  { characterId, message? , opening? }
 * 브라우저 AI 레벨(크롬 내장 LLM) 전용: 서버가 시스템 프롬프트와 메시지 배열을 조립해 반환하고,
 * 생성은 클라이언트가 수행한 뒤 /api/chat/complete 로 반납한다.
 * 주의: 시스템 프롬프트(캐릭터 설정)가 클라이언트에 내려간다 — 브라우저 레벨의 트레이드오프.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const characterId = Number(body.characterId);
  const opening = body.opening === true;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!characterId || (!opening && !message)) {
    return NextResponse.json({ error: "characterId, message 가 필요합니다." }, { status: 400 });
  }

  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });

  const level = await resolveAiLevelForUser(userId);
  if (level?.kind !== "browser") {
    return NextResponse.json({ error: "브라우저 AI 레벨에서만 사용할 수 있습니다." }, { status: 403 });
  }

  if (opening) {
    const ctx = await loadChatContext(characterId);
    if (!ctx) return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
    if (ctx.character.status === "suspended" || ctx.world.status === "suspended") {
      return NextResponse.json({ error: "사용이 중지된 캐릭터 또는 세계관입니다." }, { status: 403 });
    }
    if (ctx.character.delete_scheduled_at || ctx.world.delete_scheduled_at) {
      return NextResponse.json({ error: "삭제 대기 중인 캐릭터 또는 세계관입니다." }, { status: 403 });
    }
    if (await isCharacterHidden(ctx.character.id)) {
      return NextResponse.json({ error: "운영 제재로 신규 대화를 시작할 수 없는 캐릭터입니다." }, { status: 403 });
    }
    const userRows = await query<{ status: string }>("SELECT status FROM users WHERE id = ?", [userId]);
    if (userRows[0]?.status === "banned") {
      return NextResponse.json({ error: "이용이 제한된 계정입니다." }, { status: 403 });
    }
    const blockMsg = await getUserChatBlockMessage(userId, true);
    if (blockMsg) return NextResponse.json({ error: blockMsg }, { status: 403 });
    const existing = await loadRecentMessages(userId, characterId, 1);
    if (existing.length > 0) return NextResponse.json({ started: false });

    // 제작자 인사말이 있으면 /api/chat/start 가 처리하므로 여기 올 일이 없지만, 방어적으로 안내
    if (ctx.character.greeting?.trim()) return NextResponse.json({ started: false });

    const [llm, cost] = await Promise.all([getLlmSettings(), getChatCostForUser(userId)]);
    // 브라우저 모델은 입력 한도가 작으므로 사전 전체는 넣지 않는다
    const system = buildSystemPrompt(ctx, { includeDictionary: false });
    const messages: LlmChatMessage[] = [
      { role: "user", content: `${formatTimeBlock(new Date(), null)}\n\n${OPENING_INSTRUCTION}` },
    ];
    return NextResponse.json({ started: true, system, messages, maxTokens: llm.maxTokens, cost });
  }

  const prepared = await prepareChatTurn(userId, characterId, message, { compact: true });
  if (!prepared.ok) {
    return NextResponse.json({ error: prepared.error }, { status: prepared.status });
  }
  const { systemPrompt, messages, chatCost, llm } = prepared.turn;
  return NextResponse.json({ system: systemPrompt, messages, maxTokens: llm.maxTokens, cost: chatCost });
}
