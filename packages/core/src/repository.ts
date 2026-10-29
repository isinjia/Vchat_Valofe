import { query } from "./mysql";
import { getRedis } from "./redis";
import type {
  CharacterPersona,
  CharacterRelationship,
  DictionaryEntry,
  Illustration,
  World,
  WorldAnniversary,
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

  const [worlds, dictionary, relationships, illustrationRows, anniversaries] = await Promise.all([
    query<World>("SELECT * FROM worlds WHERE id = ?", [character.world_id]),
    // 세계관 공통(character_id NULL) + 이 캐릭터 전용 지식만 로드
    query<DictionaryEntry>(
      `SELECT * FROM world_dictionary
       WHERE world_id = ? AND (character_id IS NULL OR character_id = ?)
       ORDER BY category, sort_order, id`,
      [character.world_id, characterId]
    ),
    query<CharacterRelationship>(
      `SELECT r.*, d.title AS target_title, d.category AS target_category, d.linked_character_id
       FROM character_relationships r
       JOIN world_dictionary d ON d.id = r.target_entry_id
       WHERE r.character_id = ?`,
      [characterId]
    ),
    query("SELECT * FROM illustrations WHERE character_id = ? ORDER BY sort_order, id", [
      characterId,
    ]),
    query<WorldAnniversary>(
      // 세계관 공통(character_id NULL) + 이 캐릭터 개인 기념일
      "SELECT * FROM world_anniversaries WHERE world_id = ? AND (character_id IS NULL OR character_id = ?) ORDER BY month, day",
      [character.world_id, characterId]
    ),
  ]);
  if (worlds.length === 0) return null;

  const ctx: ChatContext = {
    world: worlds[0],
    dictionary: dictionary.map(parseDictionary),
    character,
    relationships,
    illustrations: illustrationRows.map(parseIllustration),
    anniversaries,
  };

  try {
    await redis.set(cacheKey, JSON.stringify(ctx), "EX", CONTEXT_CACHE_TTL);
  } catch {
    // 캐시 실패는 무시
  }
  return ctx;
}

/** 관리자/스튜디오에서 캐릭터/세계관 수정 시 캐시 무효화 (채팅 컨텍스트 + 목록 캐시) */
export async function invalidateChatContext(characterId?: number): Promise<void> {
  const redis = getRedis();
  try {
    if (characterId) {
      await redis.del(`ctx:character:${characterId}`);
    } else {
      const keys = await redis.keys("ctx:character:*");
      if (keys.length > 0) await redis.del(...keys);
    }
    // 메인 화면 목록 캐시도 함께 무효화 (공개/이름/이미지 변경 반영)
    await redis.del("cache:web:worlds");
    const listKeys = await redis.keys("cache:web:chars:*");
    if (listKeys.length > 0) await redis.del(...listKeys);
  } catch {
    // 무시 (TTL 로 자연 만료)
  }
}
