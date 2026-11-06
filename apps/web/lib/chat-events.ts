/**
 * 채팅 화면 → 같은 페이지의 다른 구성요소(3D 동반자 등)로 흘려보내는 가벼운 이벤트.
 * window 의 CustomEvent 를 쓰므로 채팅 클라이언트와 구독자가 서로를 몰라도 된다.
 */
export type ChatEvent =
  | { type: "send" } // 유저가 메시지를 보냄 (응답 대기 시작)
  | { type: "opening" } // 첫 인사(오프닝) 생성 시작
  | { type: "text"; delta?: string } // 캐릭터 답변 조각이 도착함 (말하는 중). delta 는 립싱크용 글자
  | { type: "emotion"; emotion: string } // 답변의 감정 판정 (joy|sad|angry|shy|surprised|love|neutral)
  | { type: "end" }; // 응답 종료 (성공·실패 공통)

export const CHAT_EVENT_NAME = "vc-chat-event";

export function emitChatEvent(ev: ChatEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChatEvent>(CHAT_EVENT_NAME, { detail: ev }));
}

export function onChatEvent(handler: (ev: ChatEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<ChatEvent>).detail);
  window.addEventListener(CHAT_EVENT_NAME, listener);
  return () => window.removeEventListener(CHAT_EVENT_NAME, listener);
}
