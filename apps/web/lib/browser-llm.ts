"use client";

/**
 * Chrome 내장 AI(Gemini Nano, Prompt API) 클라이언트 래퍼.
 * - 전역 `LanguageModel` (구버전은 window.ai.languageModel) 을 기능 탐지해 사용한다.
 * - 미지원 브라우저/기기에서는 availability 가 'unavailable'.
 * - 최초 사용 시 모델 다운로드(수 GB)가 발생할 수 있다 ('downloadable' → create 시 다운로드).
 */

export type BrowserLlmAvailability = "unavailable" | "downloadable" | "downloading" | "available";

interface LmChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface LmSession {
  promptStreaming(text: string): AsyncIterable<string> & ReadableStream<string>;
  destroy?: () => void;
}

interface LanguageModelApi {
  availability(): Promise<BrowserLlmAvailability>;
  create(opts: {
    initialPrompts?: { role: string; content: string }[];
    monitor?: (m: EventTarget) => void;
  }): Promise<LmSession>;
}

function getLm(): LanguageModelApi | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { LanguageModel?: LanguageModelApi; ai?: { languageModel?: LanguageModelApi } };
  return w.LanguageModel ?? w.ai?.languageModel ?? null;
}

export async function browserLlmAvailability(): Promise<BrowserLlmAvailability> {
  const lm = getLm();
  if (!lm?.availability) return "unavailable";
  try {
    return await lm.availability();
  } catch {
    return "unavailable";
  }
}

/**
 * 시스템 프롬프트 + 이력 + 마지막 유저 메시지로 응답을 스트리밍 생성한다.
 * messages 의 마지막 요소는 반드시 user 메시지여야 한다.
 */
export async function* streamBrowserLlm(
  system: string,
  messages: LmChatMessage[],
  onDownloadProgress?: (loaded: number) => void
): AsyncGenerator<string> {
  const lm = getLm();
  if (!lm) {
    throw new Error(
      "이 브라우저는 내장 AI(Prompt API)를 지원하지 않습니다. 최신 Chrome 이 필요하며, chrome://flags 에서 Prompt API 를 켜야 할 수 있습니다. 다른 AI 레벨을 선택해 주세요."
    );
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") throw new Error("마지막 메시지가 user 가 아닙니다.");

  const initialPrompts = [
    { role: "system", content: system },
    ...messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
  ];

  let session: LmSession;
  try {
    session = await lm.create({
      initialPrompts,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          const ev = e as Event & { loaded?: number };
          if (typeof ev.loaded === "number") onDownloadProgress?.(ev.loaded);
        });
      },
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (/quota|too large|exceed/i.test(msg)) {
      throw new Error("캐릭터 설정이 브라우저 AI 의 컨텍스트 한도를 넘었습니다. 다른 AI 레벨을 선택해 주세요.");
    }
    throw new Error(`브라우저 AI 세션 생성 실패: ${msg}`);
  }

  try {
    // 현행 Prompt API 는 청크가 델타(추가분)로 온다
    for await (const chunk of session.promptStreaming(last.content)) {
      yield chunk;
    }
  } finally {
    session.destroy?.();
  }
}
