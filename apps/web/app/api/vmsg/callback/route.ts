import { NextRequest, NextResponse } from "next/server";
import { getVmsgSettings } from "@vchatbot/core";
import {
  verifyVmsgSignature,
  clientIpFromHeaders,
  markVmsgEventOnce,
  handleVmsgMessage,
  type VmsgCallbackMessage,
} from "@/lib/vmsg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vmsg/callback — VMessage(VMsgCenter) 챗봇 콜백 수신.
 * VMessage 관리자 화면 챗봇 메뉴에 이 주소를 콜백으로 등록한다.
 *
 * 인증: 허용 IP(설정, 비면 생략) + HMAC 서명(X-VMsg-Signature, 항상 검증).
 * 5초 안에 2xx 를 줘야 하므로 LLM 처리는 응답 후 백그라운드로 진행하고,
 * 답장은 VMessage 의 POST /bot/v1/messages 로 비동기 발송한다.
 */
export async function POST(req: NextRequest) {
  const settings = await getVmsgSettings();
  if (!settings.enabled) {
    return NextResponse.json({ error: "disabled" }, { status: 403 });
  }

  // 허용 IP: 목록이 비어 있지 않으면 프록시 헤더 기준으로 검사
  if (settings.allowedIps.length > 0) {
    const ip = clientIpFromHeaders(req.headers);
    if (!ip || !settings.allowedIps.includes(ip)) {
      console.warn(`vmsg callback 차단 — 허용되지 않은 IP: ${ip ?? "(unknown)"}`);
      return NextResponse.json({ error: "forbidden_ip" }, { status: 403 });
    }
  }

  // 서명 검증은 받은 본문 바이트 그대로 수행해야 한다 (재직렬화 금지)
  const rawBody = await req.text();
  const botId = (req.headers.get("x-vmsg-bot-id") ?? "").trim();
  const bot = settings.bots.find((b) => b.enabled && b.botClientId === botId);
  if (!bot) {
    console.warn(`vmsg callback 차단 — 미등록/비활성 챗봇: ${botId || "(없음)"}`);
    return NextResponse.json({ error: "unknown_bot" }, { status: 403 });
  }
  const okSig = verifyVmsgSignature(
    bot.clientSecret,
    req.headers.get("x-vmsg-timestamp"),
    req.headers.get("x-vmsg-signature"),
    rawBody
  );
  if (!okSig) {
    console.warn(`vmsg callback 차단 — 서명 검증 실패 (bot=${botId})`);
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let ev: VmsgCallbackMessage;
  try {
    ev = JSON.parse(rawBody) as VmsgCallbackMessage;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 관리자 화면 [콜백 테스트] — 2xx 만 주면 된다
  if (ev.event === "ping") return NextResponse.json({ ok: true });
  if (ev.event !== "message") return NextResponse.json({ ok: true, ignored: ev.event });

  // 텍스트만 처리 (이미지 등은 조용히 무시)
  if (ev.message?.type !== "text" || !String(ev.message.text ?? "").trim()) {
    return NextResponse.json({ ok: true, ignored: "non_text" });
  }
  if (!ev.user || !Number.isFinite(Number(ev.user.uid))) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  // 재시도(3초 뒤 1회) 중복 방지
  if (!(await markVmsgEventOnce(String(ev.eventId ?? "")))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // 5초 응답 제한 — LLM 턴은 백그라운드로 (오류는 내부에서 로그 + 사용자 안내 발송)
  void handleVmsgMessage(settings, bot, ev).catch((e) => console.error("vmsg background error:", e));

  return NextResponse.json({ ok: true });
}
