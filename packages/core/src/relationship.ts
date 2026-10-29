import type { Collection } from "mongodb";
import { query, execute } from "./mysql";
import { getMongoDb } from "./mongo";
import type { ChatMemory } from "./types";

const FACTS_MAX = 30;
const MEMORY_LIMIT = 10;

export interface CharacterStateView {
  affinity: number;
  facts: string[];
  message_count: number;
}

/** 유저 x 캐릭터 상태 조회. 행이 없으면 기본값 반환 (행 생성은 하지 않음) */
export async function getUserCharacterState(
  userId: number,
  characterId: number
): Promise<CharacterStateView> {
  const rows = await query<{ affinity: number; facts: string[] | string | null; message_count: number }>(
    "SELECT affinity, facts, message_count FROM user_character_state WHERE user_id = ? AND character_id = ?",
    [userId, characterId]
  );
  if (rows.length === 0) return { affinity: 0, facts: [], message_count: 0 };
  const r = rows[0];
  // mysql2 가 JSON 을 자동 파싱하지만 설정에 따라 문자열일 수 있음
  const raw = typeof r.facts === "string" ? JSON.parse(r.facts) : r.facts;
  return {
    affinity: r.affinity,
    facts: Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string") : [],
    message_count: r.message_count,
  };
}

/**
 * 채점 결과 반영: 호감도 누적(-100~100 클램프), 팩트 교체(있을 때만, 최대 30개), message_count +1.
 * 갱신 후 호감도를 반환한다.
 */
export async function applyScoreResult(
  userId: number,
  characterId: number,
  result: { affinityDelta: number; updatedFacts: string[] | null }
): Promise<number> {
  const cur = await getUserCharacterState(userId, characterId);
  const affinity = Math.max(-100, Math.min(100, cur.affinity + result.affinityDelta));
  const facts = result.updatedFacts ? result.updatedFacts.slice(0, FACTS_MAX) : cur.facts;
  await execute(
    `INSERT INTO user_character_state (user_id, character_id, affinity, facts, message_count)
     VALUES (?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE affinity = VALUES(affinity), facts = VALUES(facts), message_count = message_count + 1`,
    [userId, characterId, affinity, JSON.stringify(facts)]
  );
  return affinity;
}

let memIndexReady: Promise<void> | null = null;

async function memories(): Promise<Collection<ChatMemory>> {
  const db = await getMongoDb();
  const col = db.collection<ChatMemory>("chat_memories");
  if (!memIndexReady) {
    memIndexReady = (async () => {
      await col.createIndex({ userId: 1, characterId: 1, createdAt: 1 });
      await col.createIndex({ userId: 1, worldId: 1, scope: 1, createdAt: 1 });
    })().catch((e) => {
      memIndexReady = null;
      throw e;
    });
  }
  await memIndexReady;
  return col;
}

export async function saveMemory(mem: ChatMemory): Promise<void> {
  await (await memories()).insertOne({ ...mem });
}

/** 스코프별 최신 10건 (오래된 순으로 반환). character: 이 캐릭터와의 기억, world: 이 세계에 알려진 유저의 행적 */
export async function loadMemories(
  userId: number,
  characterId: number,
  worldId: number
): Promise<{ characterMemories: ChatMemory[]; worldMemories: ChatMemory[] }> {
  const col = await memories();
  const [c, w] = await Promise.all([
    col
      .find({ userId, characterId, scope: "character" }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(MEMORY_LIMIT)
      .toArray(),
    col
      .find({ userId, worldId, scope: "world" }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(MEMORY_LIMIT)
      .toArray(),
  ]);
  return { characterMemories: c.reverse(), worldMemories: w.reverse() };
}
