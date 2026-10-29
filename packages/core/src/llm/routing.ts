import { query } from "../mysql";
import { getLlmSettings } from "../settings";
import { resolveTierId } from "../coins";
import type { LlmProviderRow } from "../types";
import type { LlmAdapter } from "./adapter";
import { createAnthropicAdapter } from "./anthropic";
import { createOpenAiCompatAdapter } from "./openai-compat";

/**
 * 유저 등급에 할당된 활성 LLM 중 가중치 랜덤으로 하나를 선택한다.
 * 할당이 없으면 provider=null (호출부가 환경변수/기본 설정으로 폴백).
 */
export async function resolveLlmForUser(
  userId: number
): Promise<{ provider: LlmProviderRow | null }> {
  const tierId = await resolveTierId(userId);
  if (tierId == null) return { provider: null };

  const rows = await query<LlmProviderRow & { weight: number }>(
    `SELECT p.*, a.weight
     FROM tier_llm_assignments a
     JOIN llm_providers p ON p.id = a.llm_provider_id
     WHERE a.tier_id = ? AND p.is_active = 1`,
    [tierId]
  );
  if (rows.length === 0) return { provider: null };

  const weights = rows.map((r) => Math.max(1, Number(r.weight) || 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = Math.random() * total;
  let chosen = rows[rows.length - 1];
  for (let i = 0; i < rows.length; i++) {
    pick -= weights[i];
    if (pick < 0) {
      chosen = rows[i];
      break;
    }
  }
  const { weight: _weight, ...provider } = chosen;
  return { provider };
}

/** provider 로 어댑터 생성. null 이면 기존 동작(app_settings 의 모델 + 환경변수 키) */
export async function createAdapter(provider: LlmProviderRow | null): Promise<LlmAdapter> {
  if (!provider) {
    const llm = await getLlmSettings();
    return createAnthropicAdapter({ model: llm.model });
  }
  if (provider.provider === "openai_compatible") {
    if (!provider.base_url) {
      throw new Error(`LLM "${provider.name}": openai_compatible 는 base_url 이 필요합니다.`);
    }
    return createOpenAiCompatAdapter({
      model: provider.model,
      apiKey: provider.api_key,
      baseUrl: provider.base_url,
    });
  }
  return createAnthropicAdapter({ model: provider.model, apiKey: provider.api_key });
}
