import { query, type SqlParam } from "../mysql";
import { getLlmSettings } from "../settings";
import { resolveAiLevelForUser } from "../ai-levels";
import type { LlmProviderRow, LlmAccountRow } from "../types";
import { pickAccount } from "./accounts";
import type { LlmAdapter } from "./adapter";
import { createAnthropicAdapter } from "./anthropic";
import { createOpenAiCompatAdapter } from "./openai-compat";

/**
 * 유저의 채팅 LLM 선택: AI 레벨 할당 → 폴백 LLM → null.
 * browser 레벨은 서버에서 호출할 LLM 이 없으므로 폴백 순서로 내려간다.
 * 할당이 없으면 provider=null (호출부가 환경변수/기본 설정으로 폴백).
 */
export async function resolveLlmForUser(
  userId: number
): Promise<{ provider: LlmProviderRow | null; account: LlmAccountRow | null }> {
  const level = await resolveAiLevelForUser(userId);
  if (level && level.kind === "server") {
    const byLevel = await pickByAssignments(
      `SELECT p.*, a.weight
       FROM ai_level_llm_assignments a
       JOIN llm_providers p ON p.id = a.llm_provider_id
       WHERE a.ai_level_id = ? AND p.is_active = 1`,
      [level.id]
    );
    if (byLevel) return byLevel;
  }
  // 등급 할당이 없거나 전부 소진 → 폴백 LLM 지정 시 시도
  const { fallbackProviderId } = await getLlmSettings();
  if (fallbackProviderId) {
    const fb = await resolveProviderById(Number(fallbackProviderId));
    if (fb) return fb;
  }
  return { provider: null, account: null };
}

/** 지정 provider id 로 어댑터 생성용 정보 조회 (쿼터 계정 선택 포함). 비활성/없음/전계정소진이면 null */
export async function resolveProviderById(
  providerId: number
): Promise<{ provider: LlmProviderRow; account: LlmAccountRow | null } | null> {
  const rows = await query<LlmProviderRow>(
    "SELECT * FROM llm_providers WHERE id = ? AND is_active = 1",
    [providerId]
  );
  if (rows.length === 0) return null;
  const provider = rows[0];
  const { account, hasAccounts } = await pickAccount(provider.id);
  if (hasAccounts && !account) return null;
  return { provider, account };
}

/** 할당 조회 SQL 결과(provider + weight)에서 가중치 랜덤으로 선택 */
async function pickByAssignments(
  sql: string,
  params: SqlParam[]
): Promise<{ provider: LlmProviderRow; account: LlmAccountRow | null } | null> {
  const all = await query<LlmProviderRow & { weight: number }>(sql, params);

  // 전 계정이 월 한도를 소진한 provider 는 후보에서 제외하며 재추첨
  let rows = all;
  while (rows.length > 0) {
    const weights = rows.map((r) => Math.max(1, Number(r.weight) || 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = Math.random() * total;
    let idx = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      pick -= weights[i];
      if (pick < 0) {
        idx = i;
        break;
      }
    }
    const { weight: _weight, ...provider } = rows[idx];
    const { account, hasAccounts } = await pickAccount(provider.id);
    if (account || !hasAccounts) return { provider, account };
    rows = rows.filter((_, i) => i !== idx);
  }
  return null;
}

/** provider 로 어댑터 생성. null 이면 기존 동작(app_settings 의 모델 + 환경변수 키) */
export async function createAdapter(
  provider: LlmProviderRow | null,
  account?: LlmAccountRow | null
): Promise<LlmAdapter> {
  if (!provider) {
    const llm = await getLlmSettings();
    return createAnthropicAdapter({ model: llm.model });
  }
  const apiKey = account?.api_key || provider.api_key;
  if (provider.provider === "openai_compatible") {
    if (!provider.base_url) {
      throw new Error(`LLM "${provider.name}": openai_compatible 는 base_url 이 필요합니다.`);
    }
    return createOpenAiCompatAdapter({
      model: provider.model,
      apiKey,
      baseUrl: provider.base_url,
    });
  }
  return createAnthropicAdapter({ model: provider.model, apiKey });
}
