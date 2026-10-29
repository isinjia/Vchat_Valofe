import Anthropic from "@anthropic-ai/sdk";
import type { LlmAdapter, LlmStream, LlmStreamOptions, LlmStreamOutcome } from "./adapter";

/** Anthropic SDK 어댑터. apiKey 가 없으면 SDK 가 환경변수(ANTHROPIC_API_KEY)를 사용 */
export function createAnthropicAdapter(cfg: { model: string; apiKey?: string | null }): LlmAdapter {
  const client = new Anthropic({ apiKey: cfg.apiKey || undefined });

  return {
    streamChat(opts: LlmStreamOptions): LlmStream {
      let result: LlmStreamOutcome = { model: cfg.model, stopReason: null };

      async function* deltas(): AsyncGenerator<string> {
        const stream = client.messages.stream({
          model: cfg.model,
          max_tokens: opts.maxTokens,
          output_config: { effort: "low" }, // 대화형 채팅은 저지연 우선
          // 시스템 프롬프트는 캐릭터/세계관이 바뀌지 않는 한 동일 → 프롬프트 캐싱 대상
          system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
          messages: opts.messages,
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield event.delta.text;
          }
        }
        const final = await stream.finalMessage();
        result = {
          model: final.model,
          stopReason: final.stop_reason,
          usage: {
            inputTokens: final.usage.input_tokens,
            outputTokens: final.usage.output_tokens,
            cacheReadTokens: final.usage.cache_read_input_tokens ?? undefined,
          },
        };
      }

      return { deltas: deltas(), outcome: () => result };
    },
  };
}
