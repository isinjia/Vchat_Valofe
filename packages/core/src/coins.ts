import { getPool, query } from "./mysql";
import { getFeeSettings } from "./settings";
import { resolveAiLevelForUser } from "./ai-levels";

/** 잔액이 이 값 미만이면 차감 전에 자동 지급 */
export const AUTO_TOPUP_THRESHOLD = 10_000;
/** 자동 지급 코인 */
export const AUTO_TOPUP_AMOUNT = 100_000;

export type CoinTxType =
  | "auto_topup"
  | "chat_spend"
  | "ai_assist_spend"
  | "illust_gen_spend"
  | "video_gen_spend"
  | "chat_fee_income"
  | "world_fee_income";

export interface CoinRef {
  refType?: string;
  refId?: number;
  memo?: string;
}

/**
 * 잔액이 임계 미만이면 자동지급 후, cost 만큼 차감한다. 모두 한 트랜잭션.
 * cost <= 0 이면 차감 거래는 생략(자동지급 체크만). 반환: 처리 후 잔액
 */
export async function chargeCoins(
  userId: number,
  cost: number,
  type: CoinTxType,
  ref: CoinRef = {}
): Promise<number> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT coins FROM users WHERE id = ? FOR UPDATE", [userId]);
    const found = rows as { coins: number | string }[];
    if (found.length === 0) throw new Error(`유저를 찾을 수 없습니다: ${userId}`);
    let balance = Number(found[0].coins);

    if (balance < AUTO_TOPUP_THRESHOLD) {
      balance += AUTO_TOPUP_AMOUNT;
      await conn.query("UPDATE users SET coins = ? WHERE id = ?", [balance, userId]);
      await conn.query(
        `INSERT INTO coin_transactions (user_id, amount, balance_after, type, memo)
         VALUES (?, ?, ?, 'auto_topup', ?)`,
        [userId, AUTO_TOPUP_AMOUNT, balance, "잔액 부족 자동 지급"]
      );
    }
    if (cost > 0) {
      balance -= cost;
      await conn.query("UPDATE users SET coins = ? WHERE id = ?", [balance, userId]);
      await conn.query(
        `INSERT INTO coin_transactions (user_id, amount, balance_after, type, ref_type, ref_id, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, -cost, balance, type, ref.refType ?? null, ref.refId ?? null, ref.memo ?? null]
      );
    }
    await conn.commit();
    return balance;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** 수수료 지급 등 적립. 반환: 적립 후 잔액 */
export async function creditCoins(
  userId: number,
  amount: number,
  type: CoinTxType,
  ref: CoinRef = {}
): Promise<number> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT coins FROM users WHERE id = ? FOR UPDATE", [userId]);
    const found = rows as { coins: number | string }[];
    if (found.length === 0) throw new Error(`유저를 찾을 수 없습니다: ${userId}`);
    const balance = Number(found[0].coins) + amount;
    await conn.query("UPDATE users SET coins = ? WHERE id = ?", [balance, userId]);
    await conn.query(
      `INSERT INTO coin_transactions (user_id, amount, balance_after, type, ref_type, ref_id, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, amount, balance, type, ref.refType ?? null, ref.refId ?? null, ref.memo ?? null]
    );
    await conn.commit();
    return balance;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export interface ChatChargeTarget {
  characterId: number;
  characterOwnerId: number | null;
  worldId: number;
  worldOwnerId: number | null;
}

/**
 * 채팅/오프닝 생성 1회 과금 + 제작자·세계관 수수료 분배. 반환: 처리 후 잔액과 분배된 수수료.
 * 유저 본인이 만든 캐릭터/세계관이면 수수료는 지급하지 않는다.
 */
export async function chargeChatWithFees(
  userId: number,
  cost: number,
  target: ChatChargeTarget,
  memo?: string
): Promise<{ balance: number; creatorFee: number; worldFee: number }> {
  const balance = await chargeCoins(userId, cost, "chat_spend", {
    refType: "character",
    refId: target.characterId,
    memo,
  });
  let creatorFee = 0;
  let worldFee = 0;
  const charOwner = target.characterOwnerId;
  const worldOwner = target.worldOwnerId;
  if (charOwner && charOwner !== userId) {
    const fees = await getFeeSettings();
    // 크리에이터 등급의 수수료 가산(%p) 적용
    const bonusRows = await query<{ fee_bonus: number | string }>(
      `SELECT t.fee_bonus FROM users u JOIN chat_tiers t ON t.id = u.creator_tier_id WHERE u.id = ?`,
      [charOwner]
    );
    const bonus = Math.max(0, Number(bonusRows[0]?.fee_bonus) || 0) / 100;
    const rate = Math.min(0.9, fees.creatorRate + bonus);
    creatorFee = Math.floor(cost * rate);
    if (worldOwner && worldOwner !== charOwner && worldOwner !== userId) {
      worldFee = Math.floor(creatorFee * fees.worldRate);
    }
    const charIncome = creatorFee - worldFee;
    if (charIncome > 0) {
      await creditCoins(charOwner, charIncome, "chat_fee_income", {
        refType: "character",
        refId: target.characterId,
      });
    }
    if (worldFee > 0 && worldOwner) {
      await creditCoins(worldOwner, worldFee, "world_fee_income", {
        refType: "world",
        refId: target.worldId,
      });
    }
  }
  return { balance, creatorFee, worldFee };
}

export async function getBalance(userId: number): Promise<number> {
  const rows = await query<{ coins: number | string }>("SELECT coins FROM users WHERE id = ?", [
    userId,
  ]);
  return rows.length ? Number(rows[0].coins) : 0;
}

/** 유저 등급 ID (미지정이면 기본 등급). 없으면 null */
export async function resolveTierId(userId: number): Promise<number | null> {
  const users = await query<{ tier_id: number | null }>("SELECT tier_id FROM users WHERE id = ?", [
    userId,
  ]);
  if (users[0]?.tier_id != null) return users[0].tier_id;
  const def = await query<{ id: number }>(
    "SELECT id FROM chat_tiers WHERE is_default = 1 ORDER BY id LIMIT 1"
  );
  return def[0]?.id ?? null;
}

/**
 * 채팅 1회 코인 비용.
 * AI 레벨이 있으면: 레벨 기본 비용 × (1 - 유저 등급 할인율%).
 * 레벨이 없으면(레거시): 등급의 chat_cost.
 */
export async function getChatCostForUser(userId: number): Promise<number> {
  const level = await resolveAiLevelForUser(userId);
  const tierId = await resolveTierId(userId);
  let tierCost = 100;
  let discount = 0;
  if (tierId != null) {
    const rows = await query<{ chat_cost: number; discount_rate: number | string }>(
      "SELECT chat_cost, discount_rate FROM chat_tiers WHERE id = ?",
      [tierId]
    );
    if (rows.length) {
      tierCost = Number(rows[0].chat_cost);
      discount = Math.min(100, Math.max(0, Number(rows[0].discount_rate) || 0));
    }
  }
  if (level) return Math.max(0, Math.ceil(Number(level.chat_cost) * (1 - discount / 100)));
  return tierCost;
}
