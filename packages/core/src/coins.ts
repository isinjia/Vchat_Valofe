import { getPool, query } from "./mysql";
import { getFeeSettings } from "./settings";

/** 잔액이 이 값 미만이면 차감 전에 자동 지급 */
export const AUTO_TOPUP_THRESHOLD = 10_000;
/** 자동 지급 코인 */
export const AUTO_TOPUP_AMOUNT = 100_000;

export type CoinTxType =
  | "auto_topup"
  | "chat_spend"
  | "ai_assist_spend"
  | "illust_gen_spend"
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
    creatorFee = Math.floor(cost * fees.creatorRate);
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

/** 유저 등급의 채팅 1회 코인 비용 (등급 없으면 100) */
export async function getChatCostForUser(userId: number): Promise<number> {
  const tierId = await resolveTierId(userId);
  if (tierId == null) return 100;
  const rows = await query<{ chat_cost: number }>("SELECT chat_cost FROM chat_tiers WHERE id = ?", [
    tierId,
  ]);
  return rows.length ? Number(rows[0].chat_cost) : 100;
}
