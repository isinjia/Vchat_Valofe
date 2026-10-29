import { query } from "./mysql";
import { getRedis } from "./redis";
import type {
  CharacterPersona,
  CharacterRelationship,
  DictionaryEntry,
  Illustration,
  World,
} from "./types";
import type { ChatContext } from "./prompt";

const CONTEXT_CACHE_TTL = 60; // 초. 관리자 수정 반영 지연 허용 범위

function parseIllustration(row: Record<string, unknown>): Illustration {
  const raw = row.trigger_condition;
  return {
    ...(row as unknown as Illustration),
    trigger_condition: raw == null ? null : typeof raw === "string" ? JSON.parse(raw) : raw,
  };
}

function parseDictionary(row: DictionaryEntry): DictionaryEntry {
  const raw = row.embedding as unknown;
  return {
    ...row,
    embedding: raw == null ? null : typeof raw === "string" ? JSON.parse(raw) : (raw as number[]),
  };
}

/** 채팅에 필요한 세계관+캐릭터 컨텍스트 전체를 로드 (Redis 캐시) */
export async function loadChatContext(characterId: number): Promise<ChatContext | null> {
  const redis = getRedis();
  const cacheKey = `ctx:character:${characterId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as ChatContext;
  } catch {
    // Redis 장애 시 DB 직행
  }

  const characters = await query<CharacterPersona>(
    "SELECT * FROM characters WHERE id = ? AND is_active = 1",
    [characterId]
  );
  if (characters.length === 0) return null;
  const character = characters[0];

  const [worlds, dictionary, relationships, illustrationRows] = await Promise.all([
    query<World>("SELECT * FROM worlds WHERE id = ?", [character.world_id]),
    query<DictionaryEntry>(
      "SELECT * FROM world_dictionary WHERE world_id = ? ORDER BY category, sort_order, id",
      [character.world_id]
    ),
    query<CharacterRelationship>(
      `SELECT r.*, c.name AS target_name
       FROM character_relationships r
       JOIN characters c ON c.id = r.target_character_id
       WHERE r.character_id = ?`,
      [characterId]
    ),
    query("SELECT * FROM illustrations WHERE character_id = ? ORDER BY sort_order, id", [
      characterId,
    ]),
  ]);
  if (worlds.length === 0) return null;

  const ctx: ChatContext = {
    world: worlds[0],
    dictionary: dictionary.map(parseDictionary),
    character,
    relationships,
    illustrations: illustrationRows.map(parseIllustration),
  };

  try {
    await redis.set(cacheKey, JSON.stringify(ctx), "EX", CONTEXT_CACHE_TTL);
  } catch {
    // 캐시 실패는 무시
  }
  return ctx;
}

/** 관리자에서 캐릭터/세계관 수정 시 캐시 무효화 */
export async function invalidateChatContext(characterId?: number): Promise<void> {
  const redis = getRedis();
  try {
    if (characterId) {
      await redis.del(`ctx:character:${characterId}`);
    } else {
      const keys = await redis.keys("ctx:character:*");
      if (keys.length > 0) await redis.del(...keys);
    }
  } catch {
    // 무시 (TTL 로 자연 만료)
  }
}
