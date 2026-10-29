import type { LlmAdapter, LlmStream, LlmStreamOptions, LlmStreamOutcome } from "./adapter";

/** OpenAI 호환(chat/completions) 어댑터 — DeepSeek, Kimi 등. 외부 패키지 없이 fetch 로 구현 */
export function createOpenAiCompatAdapter(cfg: {
  model: string;
  apiKey?: string | null;
  baseUrl: string;
}): LlmAdapter {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;

  return {
    streamChat(opts: LlmStreamOptions): LlmStream {
      const result: LlmStreamOutcome = { model: cfg.model, stopReason: null };

      async function* deltas(): AsyncGenerator<string> {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: opts.maxTokens,
            stream: true,
            stream_options: { include_usage: true }, // 마지막 청크에 토큰 사용량 포함
            messages: [{ role: "system", content: opts.system }, ...opts.messages],
          }),
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(`OpenAI 호환 API 오류 (${res.status}): ${text.slice(0, 500)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finished = false;
        while (!finished) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buf += decoder.decode(chunk.value, { stream: true });
          // 줄 단위로 처리, 마지막 불완전 줄은 buf 에 남김
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") {
              finished = true;
              break;
            }
            let json: {
              model?: string;
              choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
            };
            try {
              json = JSON.parse(payload);
            } catch {
              continue;
            }
            if (json.model) result.model = json.model;
            if (json.usage && typeof json.usage.prompt_tokens === "number") {
              result.usage = {
                inputTokens: json.usage.prompt_tokens,
                outputTokens: json.usage.completion_tokens ?? 0,
              };
            }
            const choice = json.choices?.[0];
            if (choice?.delta?.content) yield choice.delta.content;
            if (choice?.finish_reason) result.stopReason = choice.finish_reason;
          }
        }
        reader.cancel().catch(() => {});
      }

      return { deltas: deltas(), outcome: () => result };
    },
  };
}
