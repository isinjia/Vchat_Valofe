export interface LlmChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmStreamOptions {
  system: string;
  messages: LlmChatMessage[];
  maxTokens: number;
}

export interface LlmStreamOutcome {
  model: string;
  stopReason: string | null;
  /** 토큰 사용량 (제공자가 반환하지 않으면 undefined) */
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
}

/** 스트리밍 결과: deltas 를 모두 소비한 뒤 outcome() 으로 모델/종료사유를 조회한다 */
export interface LlmStream {
  deltas: AsyncGenerator<string>;
  outcome: () => LlmStreamOutcome;
}

export interface LlmAdapter {
  streamChat(opts: LlmStreamOptions): LlmStream;
}
