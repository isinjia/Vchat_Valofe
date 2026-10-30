const CONDITION_KEYS = [
  "messages",
  "tokensUsed",
  "chatCharacters",
  "chatWorlds",
  "affinityMax",
  "spentCoins",
  "createdWorlds",
  "createdCharacters",
  "publicWorlds",
  "publicCharacters",
  "feeEarned",
  "receivedChats",
] as const;

/** 조건 객체 → 허용 키 + 양수 값만 남긴 JSON 문자열 (없으면 null) */
export function sanitizeConditions(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, number> = {};
  for (const k of CONDITION_KEYS) {
    const v = Number((input as Record<string, unknown>)[k]);
    if (Number.isFinite(v) && v > 0) out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}
