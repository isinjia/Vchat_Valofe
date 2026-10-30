import { query, execute } from "../mysql";
import type { LlmAccountRow } from "../types";

export type { LlmAccountRow };

/** 현재 월 'YYYY-MM' (UTC) */
export function currentMonthUtc(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * provider 의 활성 계정 중 월 한도 내에서 이번 달 사용량이 가장 적은 계정을 선택한다.
 * - 등록 계정 0개: { account: null, hasAccounts: false } (provider 자체 api_key 사용)
 * - 계정은 있으나 전부 소진: { account: null, hasAccounts: true }
 */
export async function pickAccount(
  providerId: number
): Promise<{ account: LlmAccountRow | null; hasAccounts: boolean }> {
  const rows = await query<LlmAccountRow & { used: number | string }>(
    `SELECT a.id, a.llm_provider_id, a.label, a.api_key, a.monthly_token_limit, a.is_active,
            COALESCE(u.input_tokens + u.output_tokens, 0) AS used
     FROM llm_accounts a
     LEFT JOIN llm_account_usage u ON u.llm_account_id = a.id AND u.month = ?
     WHERE a.llm_provider_id = ? AND a.is_active = 1`,
    [currentMonthUtc(), providerId]
  );
  if (rows.length === 0) return { account: null, hasAccounts: false };

  let best: (LlmAccountRow & { used: number }) | null = null;
  for (const r of rows) {
    const used = Number(r.used) || 0;
    const limit = Number(r.monthly_token_limit) || 0;
    if (limit > 0 && used >= limit) continue;
    if (!best || used < best.used) best = { ...r, used };
  }
  if (!best) return { account: null, hasAccounts: true };
  const { used: _used, ...account } = best;
  return { account, hasAccounts: true };
}

/**
 * provider/계정 사용량을 한 번에 기록. 모두 non-throwing.
 * provider 단위 기록은 계정 미등록 호출도 포함돼 예상 비용 집계에 쓰인다.
 */
export async function recordLlmUsage(
  providerId: number | null | undefined,
  accountId: number | null | undefined,
  usage: { inputTokens: number; outputTokens: number }
): Promise<void> {
  if (providerId) await recordProviderUsage(providerId, usage);
  if (accountId) await recordAccountUsage(accountId, usage);
}

/** 프로바이더 단위 이번 달 사용량 누적. 실패해도 throw 하지 않는다. */
export async function recordProviderUsage(
  providerId: number,
  usage: { inputTokens: number; outputTokens: number }
): Promise<void> {
  try {
    await execute(
      `INSERT INTO llm_provider_usage (llm_provider_id, month, input_tokens, output_tokens, request_count)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         input_tokens = input_tokens + VALUES(input_tokens),
         output_tokens = output_tokens + VALUES(output_tokens),
         request_count = request_count + 1`,
      [providerId, currentMonthUtc(), Number(usage.inputTokens) || 0, Number(usage.outputTokens) || 0]
    );
  } catch (e) {
    console.error("recordProviderUsage error:", e);
  }
}

/** 이번 달 사용량 누적. 실패해도 throw 하지 않는다 (채팅 응답을 막으면 안 됨). */
export async function recordAccountUsage(
  accountId: number,
  usage: { inputTokens: number; outputTokens: number }
): Promise<void> {
  try {
    await execute(
      `INSERT INTO llm_account_usage (llm_account_id, month, input_tokens, output_tokens, request_count)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         input_tokens = input_tokens + VALUES(input_tokens),
         output_tokens = output_tokens + VALUES(output_tokens),
         request_count = request_count + 1`,
      [accountId, currentMonthUtc(), Number(usage.inputTokens) || 0, Number(usage.outputTokens) || 0]
    );
  } catch (e) {
    console.error("recordAccountUsage error:", e);
  }
}
