import crypto from "crypto";
import {
  getRedis,
  resolveLlmForUser,
  createAdapter,
  recordLlmUsage,
  loadRecentMessages,
  query,
  type VmsgBotConfig,
  type VmsgSettings,
} from "@vchatbot/core";
import { prepareChatTurn, finishChatTurn } from "@/lib/chat-pipeline";

/**
 * VMsgCenter(VMessage 런처 메신저) 챗봇 연동.
 * 콜백(사용자 → 챗봇)은 /api/vmsg/callback 이 받고, 답장(챗봇 → 사용자)은
 * VMessage 서버의 POST /bot/v1/messages 를 호출하는 비동기 구조다 (스펙: VMessage docs/api/Chatbot_API.md).
 */

/** 콜백 본문 (event: "message") */
export interface VmsgCallbackMessage {
  event: string;
  eventId: string;
  botClientId: string;
  convId: number;
  user: { uid: number; region: string; userSerial: string; nickname: string };
  message: { msgId: number; type: string; text: string; createdAt: number };
}

/** 서명 timestamp 허용 오차 (초) */
const TIMESTAMP_SKEW_SEC = 300;
/** VMessage 메시지 1건 최대 길이 */
const VMSG_MAX_TEXT = 2000;
/** 답장 API 타임아웃 */
const SEND_TIMEOUT_MS = 10_000;

/**
 * 콜백 HMAC 서명 검증: X-VMsg-Signature = "sha256=" + HMAC-SHA256(secret, timestamp + "." + raw body) hex.
 * 본문은 재직렬화하지 말고 받은 바이트 그대로 검증해야 한다.
 */
export function verifyVmsgSignature(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  rawBody: string
): boolean {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TIMESTAMP_SKEW_SEC) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 프록시 헤더에서 클라이언트 IP 추출 (::ffff: 접두 IPv4 정규화) */
export function clientIpFromHeaders(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  const raw = (fwd ? fwd.split(",")[0] : headers.get("x-real-ip")) ?? "";
  const ip = raw.trim();
  if (!ip) return null;
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/** eventId 중복 수신 방지 (VMessage 는 실패 시 3초 뒤 1회 재시도) — 처음 보는 eventId 면 true */
export async function markVmsgEventOnce(eventId: string): Promise<boolean> {
  try {
    const r = await getRedis().set(`vmsg:evt:${eventId}`, "1", "EX", 86400, "NX");
    return r === "OK";
  } catch (e) {
    // Redis 장애 시에는 중복 위험보다 유실이 더 나쁘므로 통과시킨다
    console.error("vmsg dedup redis error:", e);
    return true;
  }
}

/** 2000자 제한에 맞춰 분할 (가능하면 문단/줄 경계에서 자른다) */
export function splitForVmsg(text: string, max = VMSG_MAX_TEXT): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

export interface VmsgSendResult {
  ok: boolean;
  /** 사용자가 챗봇을 차단/삭제함 (403 blocked_by_user) — 이후 발송 중단 */
  blocked?: boolean;
  error?: string;
}

/** VMessage 로 텍스트 1건 발송 */
async function postVmsgMessage(
  settings: VmsgSettings,
  bot: VmsgBotConfig,
  uid: number,
  text: string,
  clientMsgId: string
): Promise<VmsgSendResult> {
  if (!settings.apiBase) return { ok: false, error: "apiBase 미설정" };
  let res: Response;
  try {
    res = await fetch(`${settings.apiBase}/bot/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Client-Id": bot.botClientId,
        "X-Client-Secret": bot.clientSecret,
      },
      body: JSON.stringify({ uid, text, clientMsgId: clientMsgId.slice(0, 64) }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: `연결 실패: ${(e as Error).message}` };
  }
  if (res.ok) return { ok: true };
  let code = "";
  try {
    code = String(((await res.json()) as { error?: string }).error ?? "");
  } catch {
    // 본문 없는 오류
  }
  if (res.status === 403 && code === "blocked_by_user") return { ok: false, blocked: true, error: code };
  return { ok: false, error: `${res.status} ${code}` };
}

/** 긴 답장을 분할 발송. 중간에 차단되면 중단 */
async function sendVmsgText(
  settings: VmsgSettings,
  bot: VmsgBotConfig,
  uid: number,
  text: string,
  clientMsgIdBase: string
): Promise<void> {
  const parts = splitForVmsg(text);
  for (let i = 0; i < parts.length; i++) {
    const r = await postVmsgMessage(settings, bot, uid, parts[i], i === 0 ? clientMsgIdBase : `${clientMsgIdBase.slice(0, 60)}#${i + 1}`);
    if (!r.ok) {
      console.error(`vmsg send 실패 (bot=${bot.botClientId}, uid=${uid}):`, r.error);
      if (r.blocked) return;
    }
  }
}

/**
 * userSerial(KR = vfun u_no) → users.id.
 * 메신저에서 새 계정을 만들지는 않는다 — VChatBot 에 로그인한 적 있는 유저만 매핑된다.
 */
async function resolveVmsgUser(user: VmsgCallbackMessage["user"]): Promise<number | null> {
  if (user.region !== "KR") return null;
  const uNo = Number(user.userSerial);
  if (!Number.isInteger(uNo) || uNo <= 0) return null;
  const rows = await query<{ id: number }>("SELECT id FROM users WHERE vfun_u_no = ?", [uNo]);
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * 콜백 메시지 1건 처리 (콜백 응답 후 백그라운드 실행):
 * 유저 매핑 → 일반 채팅과 동일한 prepare → 서버 LLM → finish(과금/채점/저장) → VMessage 로 답장 발송.
 * 과금은 웹 채팅과 동일하게 해당 유저 코인에서 차감된다 (finishChatTurn 의 chargeChatWithFees).
 */
export async function handleVmsgMessage(
  settings: VmsgSettings,
  bot: VmsgBotConfig,
  ev: VmsgCallbackMessage
): Promise<void> {
  const uid = ev.user.uid;
  const reply = (text: string, suffix = "") => sendVmsgText(settings, bot, uid, text, `${ev.eventId}${suffix}`);
  try {
    const userId = await resolveVmsgUser(ev.user);
    if (!userId) {
      await reply(
        ev.user.region === "KR"
          ? "VChatBot 계정을 찾을 수 없어요. 먼저 VChatBot 에 로그인해 주세요."
          : "지금은 한국 VFUN 계정으로만 대화할 수 있어요."
      );
      return;
    }
    // 메신저에서 새 대화는 시작할 수 없다 — 서비스에서 먼저 시작한 대화만 이어서 진행
    const existing = await loadRecentMessages(userId, bot.characterId, 1);
    if (existing.length === 0) {
      await reply("아직 시작한 대화가 없어요. 먼저 VChatBot 에서 대화를 시작하면 메신저에서도 이어갈 수 있어요.");
      return;
    }
    const prepared = await prepareChatTurn(userId, bot.characterId, ev.message.text);
    if (!prepared.ok) {
      await reply(prepared.error);
      return;
    }
    const { ctx, chatCost, systemPrompt, messages, history, state, llm } = prepared.turn;

    const { provider, account } = await resolveLlmForUser(userId);
    const adapter = await createAdapter(provider, account);
    const llmStream = adapter.streamChat({
      system: systemPrompt,
      messages,
      maxTokens: provider ? provider.max_tokens : llm.maxTokens,
    });
    let assistantText = "";
    for await (const delta of llmStream.deltas) assistantText += delta;
    const outcome = llmStream.outcome();
    if (outcome.usage) {
      await recordLlmUsage(provider?.id ?? null, account?.id ?? null, outcome.usage);
    }

    // SSE 대신 이벤트를 모아 뒀다가 메신저 메시지로 변환한다.
    // 호감도/코인 등 내부 수치는 메신저로 보내지 않는다 (유저 화면 비노출 원칙)
    let errorMsg: string | null = null;
    let guestLine: string | null = null;
    let eventLine: string | null = null;
    const collect = (data: unknown) => {
      const d = data as { type?: string; message?: string; name?: string; text?: string; line?: string };
      if (d.type === "error" && d.message) errorMsg = d.message;
      else if (d.type === "guest" && d.name && d.text) guestLine = `[${d.name}] ${d.text}`;
      else if (d.type === "event" && d.line) eventLine = d.line;
    };
    await finishChatTurn(collect, {
      userId,
      ctx,
      history,
      state,
      message: ev.message.text,
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
        vmsg: { convId: ev.convId, msgId: ev.message.msgId },
      },
      usage: outcome.usage ?? null,
      event: prepared.turn.event,
    });

    if (errorMsg) {
      await reply(errorMsg);
      return;
    }
    if (assistantText.trim()) await reply(assistantText);
    if (guestLine) await reply(guestLine, "#g");
    if (eventLine) await reply(eventLine, "#e");
  } catch (e) {
    console.error(`vmsg 처리 오류 (bot=${bot.botClientId}, event=${ev.eventId}):`, e);
    try {
      await reply("응답 생성 중 문제가 생겼어요. 잠시 후 다시 말을 걸어 주세요.");
    } catch {
      // 안내 발송까지 실패하면 로그만 남긴다
    }
  }
}
