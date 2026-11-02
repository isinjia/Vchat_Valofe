import type { Collection } from "mongodb";
import { query, execute } from "./mysql";
import { getMongoDb } from "./mongo";
import type { ChatMemory } from "./types";

const FACTS_MAX = 30;
const MEMORY_LIMIT = 10;

export type UserRelationship = "none" | "lover" | "engaged" | "married";

export const RELATIONSHIP_LABELS: Record<UserRelationship, string> = {
  none: "아직 특별한 관계 아님",
  lover: "연인",
  engaged: "약혼",
  married: "결혼",
};

export interface CharacterStateView {
  affinity: number;
  facts: string[];
  message_count: number;
  /** 이벤트 성공으로 켜지는 관계 플래그 */
  relationship: UserRelationship;
  /** 캐릭터가 유저를 부르는 호칭 (정해진 게 없으면 null) */
  call_name: string | null;
  /** 현재 장면의 지역 (world_dictionary location 항목 id, 미식별 시 null) */
  current_place_id: number | null;
  /** 현재 장면 한 줄 (자유 텍스트 — 사전에 없는 장소 포함, 채점 LLM 이 매 턴 갱신) */
  current_scene: string | null;
}

/** 유저 x 캐릭터 상태 조회. 행이 없으면 기본값 반환 (행 생성은 하지 않음) */
export async function getUserCharacterState(
  userId: number,
  characterId: number
): Promise<CharacterStateView> {
  const rows = await query<{
    affinity: number;
    facts: string[] | string | null;
    message_count: number;
    relationship: UserRelationship;
    call_name: string | null;
    current_place_id: number | null;
    current_scene: string | null;
  }>(
    "SELECT affinity, facts, message_count, relationship, call_name, current_place_id, current_scene FROM user_character_state WHERE user_id = ? AND character_id = ?",
    [userId, characterId]
  );
  if (rows.length === 0) {
    return { affinity: 0, facts: [], message_count: 0, relationship: "none", call_name: null, current_place_id: null, current_scene: null };
  }
  const r = rows[0];
  // mysql2 가 JSON 을 자동 파싱하지만 설정에 따라 문자열일 수 있음
  const raw = typeof r.facts === "string" ? JSON.parse(r.facts) : r.facts;
  return {
    affinity: r.affinity,
    facts: Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string") : [],
    message_count: r.message_count,
    relationship: r.relationship ?? "none",
    call_name: r.call_name ?? null,
    current_place_id: r.current_place_id ?? null,
    current_scene: r.current_scene ?? null,
  };
}

/** 현재 장면의 지역 갱신 (채점 LLM 이 식별했을 때만 호출). 행이 없으면 생성 */
export async function setUserCurrentPlace(
  userId: number,
  characterId: number,
  placeId: number | null
): Promise<void> {
  await execute(
    `INSERT INTO user_character_state (user_id, character_id, current_place_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE current_place_id = VALUES(current_place_id)`,
    [userId, characterId, placeId]
  );
}

/** 현재 장면 한 줄(자유 텍스트) 갱신. null 이면 장면 종료(실시간 모드 장면 전환). 행이 없으면 생성 */
export async function setUserCurrentScene(
  userId: number,
  characterId: number,
  scene: string | null
): Promise<void> {
  await execute(
    `INSERT INTO user_character_state (user_id, character_id, current_scene)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE current_scene = VALUES(current_scene)`,
    [userId, characterId, scene ? scene.slice(0, 300) : null]
  );
}

/** 관계 플래그 설정 (이벤트 성공 시). 행이 없으면 생성 */
export async function setUserRelationship(
  userId: number,
  characterId: number,
  relationship: UserRelationship
): Promise<void> {
  await execute(
    `INSERT INTO user_character_state (user_id, character_id, relationship)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE relationship = VALUES(relationship)`,
    [userId, characterId, relationship]
  );
}

/**
 * 채점 결과 반영: 호감도 누적(-100~100 클램프), 팩트 교체(있을 때만, 최대 30개), message_count +1.
 * 갱신 후 호감도를 반환한다.
 */
export async function applyScoreResult(
  userId: number,
  characterId: number,
  result: { affinityDelta: number; updatedFacts: string[] | null; callName?: string | null }
): Promise<number> {
  const cur = await getUserCharacterState(userId, characterId);
  const affinity = Math.max(-100, Math.min(100, cur.affinity + result.affinityDelta));
  const facts = result.updatedFacts ? result.updatedFacts.slice(0, FACTS_MAX) : cur.facts;
  // 호칭: 새로 정해졌을 때만 교체 (null 이면 기존 유지)
  const callName = result.callName?.trim().slice(0, 64) || cur.call_name;
  await execute(
    `INSERT INTO user_character_state (user_id, character_id, affinity, facts, call_name, message_count)
     VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE affinity = VALUES(affinity), facts = VALUES(facts),
       call_name = VALUES(call_name), message_count = message_count + 1`,
    [userId, characterId, affinity, JSON.stringify(facts), callName]
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
