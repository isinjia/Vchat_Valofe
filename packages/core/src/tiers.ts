import { query, execute } from "./mysql";
import type { ChatTier } from "./types";

/**
 * 등급 자동 승급 조건. 모든 항목을 충족하면(AND) 해당 등급으로 승급한다.
 * user 트랙 주 지표: messages, tokensUsed, chatCharacters, chatWorlds, affinityMax, spentCoins
 * creator 트랙 주 지표: createdWorlds, createdCharacters, publicWorlds, publicCharacters, feeEarned, receivedChats
 */
export interface TierConditions {
  /** 보낸 채팅 메시지 수 */
  messages?: number;
  /** 사용한 토큰 (입력+출력) */
  tokensUsed?: number;
  /** 대화한 캐릭터 수 */
  chatCharacters?: number;
  /** 대화한 월드 수 */
  chatWorlds?: number;
  /** 어느 캐릭터든 달성한 최고 호감도 */
  affinityMax?: number;
  /** 사용(차감)한 코인 누계 */
  spentCoins?: number;
  /** 생성한 월드 수 */
  createdWorlds?: number;
  /** 생성한 캐릭터 수 */
  createdCharacters?: number;
  /** 공개(open)한 월드 수 */
  publicWorlds?: number;
  /** 공개(open)한 캐릭터 수 */
  publicCharacters?: number;
  /** 수수료 수익(코인) 누계 */
  feeEarned?: number;
  /** 내 캐릭터들이 받은 대화 수 합계 */
  receivedChats?: number;
  /** 누적 제재 횟수 (본인 제재 + 내 캐릭터 제재, 해제/만료 포함 이력 전체) */
  sanctionCount?: number;
}

export const TIER_CONDITION_LABELS: Record<string, string> = {
  messages: "보낸 메시지 수",
  tokensUsed: "사용 토큰(입력+출력)",
  chatCharacters: "대화한 캐릭터 수",
  chatWorlds: "대화한 월드 수",
  affinityMax: "최고 호감도",
  spentCoins: "사용한 코인",
  createdWorlds: "생성한 월드 수",
  createdCharacters: "생성한 캐릭터 수",
  publicWorlds: "공개한 월드 수",
  publicCharacters: "공개한 캐릭터 수",
  feeEarned: "수수료 수익(코인)",
  receivedChats: "내 캐릭터가 받은 대화 수",
  sanctionCount: "제재 횟수(본인+내 캐릭터)",
};

/** 채팅 활동 증분 기록 (메시지/토큰). 실패해도 throw 하지 않는다 */
export async function recordUserActivity(
  userId: number,
  delta: { messages?: number; tokens?: number }
): Promise<void> {
  const messages = Math.max(0, Math.floor(delta.messages ?? 0));
  const tokens = Math.max(0, Math.floor(delta.tokens ?? 0));
  if (messages === 0 && tokens === 0) return;
  try {
    await execute(
      `INSERT INTO user_stats (user_id, messages, tokens_used) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE messages = messages + VALUES(messages), tokens_used = tokens_used + VALUES(tokens_used)`,
      [userId, messages, tokens]
    );
  } catch (e) {
    console.error("recordUserActivity error:", e);
  }
}

/** 승급 평가에 쓰는 유저 활동 지표 전체 */
export async function getUserTierMetrics(userId: number): Promise<Record<string, number>> {
  const [stats, chatChars, chatWorlds, affinityMax, spent, created, pub, fees, received, sanctions] =
    await Promise.all([
      query<{ messages: number; tokens_used: number }>(
        "SELECT messages, tokens_used FROM user_stats WHERE user_id = ?",
        [userId]
      ),
      query<{ n: number }>("SELECT COUNT(*) AS n FROM user_character_state WHERE user_id = ?", [userId]),
      query<{ n: number }>(
        `SELECT COUNT(DISTINCT c.world_id) AS n
         FROM user_character_state s JOIN characters c ON c.id = s.character_id
         WHERE s.user_id = ?`,
        [userId]
      ),
      query<{ n: number | null }>("SELECT MAX(affinity) AS n FROM user_character_state WHERE user_id = ?", [userId]),
      query<{ n: number | string | null }>(
        `SELECT COALESCE(SUM(-amount), 0) AS n FROM coin_transactions
         WHERE user_id = ? AND amount < 0`,
        [userId]
      ),
      query<{ worlds: number; chars: number }>(
        `SELECT (SELECT COUNT(*) FROM worlds WHERE owner_user_id = ?) AS worlds,
                (SELECT COUNT(*) FROM characters WHERE owner_user_id = ?) AS chars`,
        [userId, userId]
      ),
      query<{ worlds: number; chars: number }>(
        `SELECT (SELECT COUNT(*) FROM worlds WHERE owner_user_id = ? AND visibility = 'open') AS worlds,
                (SELECT COUNT(*) FROM characters WHERE owner_user_id = ? AND visibility = 'open') AS chars`,
        [userId, userId]
      ),
      query<{ n: number | string | null }>(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM coin_transactions
         WHERE user_id = ? AND type IN ('chat_fee_income', 'world_fee_income')`,
        [userId]
      ),
      query<{ n: number | string | null }>(
        "SELECT COALESCE(SUM(chat_count), 0) AS n FROM characters WHERE owner_user_id = ?",
        [userId]
      ),
      query<{ n: number | string | null }>(
        `SELECT COUNT(*) AS n FROM sanctions s
         WHERE (s.target_type = 'user' AND s.target_id = ?)
            OR (s.target_type = 'character'
                AND s.target_id IN (SELECT id FROM characters WHERE owner_user_id = ?))`,
        [userId, userId]
      ),
    ]);
  return {
    messages: Number(stats[0]?.messages) || 0,
    tokensUsed: Number(stats[0]?.tokens_used) || 0,
    chatCharacters: Number(chatChars[0]?.n) || 0,
    chatWorlds: Number(chatWorlds[0]?.n) || 0,
    affinityMax: Number(affinityMax[0]?.n) || 0,
    spentCoins: Number(spent[0]?.n) || 0,
    createdWorlds: Number(created[0]?.worlds) || 0,
    createdCharacters: Number(created[0]?.chars) || 0,
    publicWorlds: Number(pub[0]?.worlds) || 0,
    publicCharacters: Number(pub[0]?.chars) || 0,
    feeEarned: Number(fees[0]?.n) || 0,
    receivedChats: Number(received[0]?.n) || 0,
    sanctionCount: Number(sanctions[0]?.n) || 0,
  };
}

/**
 * 일러스트 등급 게이트 평가용: 유저의 user 트랙 tier_rank 와 등급 id→rank 맵.
 * 등급 미지정 유저는 기본 등급 rank (기본 등급이 없으면 0).
 */
export async function getUserTierRankInfo(
  userId: number
): Promise<{ userTierRank: number; tierRankById: Map<number, number> }> {
  const [tiers, me] = await Promise.all([
    query<{ id: number; tier_rank: number; is_default: number }>(
      "SELECT id, tier_rank, is_default FROM chat_tiers WHERE track = 'user'"
    ),
    query<{ tier_id: number | null }>("SELECT tier_id FROM users WHERE id = ?", [userId]),
  ]);
  const tierRankById = new Map(tiers.map((t) => [t.id, Number(t.tier_rank)]));
  const myTierId = me[0]?.tier_id ?? null;
  const userTierRank =
    myTierId != null
      ? tierRankById.get(myTierId) ?? 0
      : Number(tiers.find((t) => t.is_default)?.tier_rank ?? 0);
  return { userTierRank, tierRankById };
}

function parseConditions(raw: unknown): TierConditions | null {
  if (raw == null) return null;
  const obj = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!obj || typeof obj !== "object") return null;
  const entries = Object.entries(obj as Record<string, unknown>).filter(
    ([, v]) => Number(v) > 0
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as TierConditions) : null;
}

export interface TierPromotion {
  track: "user" | "creator";
  name: string;
  tierId: number;
  /** up = 사다리 승급, changed = 우선 적용 등급 적용/해제 복귀 (강등 포함) */
  direction: "up" | "changed";
}

/**
 * 등급 자동 평가. 실패해도 throw 하지 않는다.
 * 1) 우선 적용(is_override) 등급: 조건 충족 시 사다리와 무관하게 최우선 적용 (강등 포함).
 *    여러 개 충족이면 tier_rank 가 높은 것.
 * 2) 우선 적용 미해당: 일반 사다리 — 조건 충족한 가장 높은 등급으로 승급(내려가지 않음).
 *    단, 현재 우선 적용 등급에 있다가 조건에서 벗어나면 사다리 기준으로 재배치(복귀).
 */
export async function evaluateTierPromotions(userId: number): Promise<TierPromotion[]> {
  try {
    const [tiers, me] = await Promise.all([
      query<ChatTier>("SELECT * FROM chat_tiers ORDER BY tier_rank DESC, id DESC"),
      query<{ tier_id: number | null; creator_tier_id: number | null }>(
        "SELECT tier_id, creator_tier_id FROM users WHERE id = ?",
        [userId]
      ),
    ]);
    if (me.length === 0) return [];
    const metrics = await getUserTierMetrics(userId);
    const promotions: TierPromotion[] = [];

    const matches = (t: ChatTier): boolean => {
      const cond = parseConditions(t.conditions);
      if (!cond) return false; // 조건 없는 등급은 자동 적용 대상 아님
      return Object.entries(cond).every(([k, v]) => (metrics[k] ?? 0) >= Number(v));
    };

    for (const track of ["user", "creator"] as const) {
      const trackTiers = tiers.filter((t) => t.track === track);
      const currentId = track === "user" ? me[0].tier_id : me[0].creator_tier_id;
      const current = trackTiers.find((t) => t.id === currentId) ?? null;
      let currentRank = current?.tier_rank ?? -1;
      if (current == null && track === "user") {
        // 미지정 유저는 기본 등급 취급
        currentRank = trackTiers.find((t) => t.is_default)?.tier_rank ?? -1;
      }

      let target: ChatTier | null = null;
      let direction: TierPromotion["direction"] = "up";

      // 1) 우선 적용 등급 (rank 내림차순이므로 첫 매칭이 최우선)
      for (const t of trackTiers) {
        if (!t.is_override) continue;
        if (matches(t)) {
          target = t;
          direction = "changed";
          break;
        }
      }

      // 2) 우선 적용 미해당 → 사다리
      if (!target) {
        if (current?.is_override) {
          // 우선 적용에서 벗어남 → 사다리 전체 재계산으로 복귀 (강등 포함)
          let best =
            trackTiers.find((t) => !t.is_override && matches(t)) ??
            (track === "user" ? trackTiers.find((t) => !t.is_override && t.is_default) ?? null : null);
          if (best && best.id !== currentId) {
            target = best;
            direction = "changed";
          }
        } else {
          // 기존 상향 사다리 (현재보다 높은 rank 중 조건 충족한 최고 등급)
          for (const t of trackTiers) {
            if (t.is_override) continue;
            if (t.tier_rank <= currentRank) break;
            if (matches(t)) {
              target = t;
              direction = "up";
              break;
            }
          }
        }
      }

      if (!target || target.id === currentId) continue;
      const column = track === "user" ? "tier_id" : "creator_tier_id";
      await execute(`UPDATE users SET ${column} = ? WHERE id = ?`, [target.id, userId]);
      await execute(
        `INSERT INTO user_notifications (user_id, type, title, body) VALUES (?, 'tier_up', ?, ?)`,
        [
          userId,
          `${track === "creator" ? "크리에이터" : "유저"} 등급 ${direction === "up" ? "상승" : "변경"} — ${target.name}`,
          target.description ?? null,
        ]
      );
      promotions.push({ track, name: target.name, tierId: target.id, direction });
    }
    return promotions;
  } catch (e) {
    console.error("evaluateTierPromotions error:", e);
    return [];
  }
}
