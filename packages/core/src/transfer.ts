import { query, execute } from "./mysql";
import { embedPassage } from "./embedding";
import { parseAnniversaryInput } from "./anniversary";
import { invalidateChatContext } from "./repository";

/**
 * 세계관/캐릭터 export·import 공용 로직 (admin / studio 가 공유).
 * 환경 간 이관(dev→stage→live)과 백업이 목적이라 id·임베딩은 포함하지 않는다.
 */

export const WORLD_FORMAT = "vchatbot-world@1";
export const CHARACTER_FORMAT = "vchatbot-character@1";

type DictRow = { category: string; title: string; aliases: string | null; content: string };
type AnnivRow = { name: string; month: number; day: number; notice_days: number; description: string };

export interface ImportResult {
  id: number;
  imported: Record<string, number>;
  warnings: string[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
const CATEGORIES = ["location", "person", "term"];

/** 세계관 export JSON (공용 사전·기념일만). 없으면 null */
export async function exportWorld(id: number): Promise<Record<string, unknown> | null> {
  const ws = await query<{ name: string; description: string; ai_prompt: string; title_image_url: string | null }>(
    "SELECT name, description, ai_prompt, title_image_url FROM worlds WHERE id = ?",
    [id]
  );
  if (ws.length === 0) return null;
  const dictionary = await query<DictRow>(
    `SELECT category, title, aliases, content FROM world_dictionary
     WHERE world_id = ? AND character_id IS NULL ORDER BY category, sort_order, id`,
    [id]
  );
  const anniversaries = await query<AnnivRow>(
    `SELECT name, month, day, notice_days, duration_days, description FROM world_anniversaries
     WHERE world_id = ? AND character_id IS NULL ORDER BY month, day, id`,
    [id]
  );
  const w = ws[0];
  return {
    format: WORLD_FORMAT,
    name: w.name,
    description: w.description,
    ai_prompt: w.ai_prompt,
    title_image_url: w.title_image_url,
    dictionary,
    anniversaries,
  };
}

/** 캐릭터 export JSON (전용 사전·개인 기념일·관계·일러스트). 없으면 null */
export async function exportCharacter(id: number): Promise<Record<string, unknown> | null> {
  const cs = await query<Record<string, unknown>>(
    `SELECT world_id, name, profile, personality, speech_style, ai_prompt, scenario, greeting, title_image_url
     FROM characters WHERE id = ?`,
    [id]
  );
  if (cs.length === 0) return null;
  const c = cs[0];
  const privateDictionary = await query<DictRow>(
    `SELECT category, title, aliases, content FROM world_dictionary
     WHERE character_id = ? ORDER BY category, sort_order, id`,
    [id]
  );
  const personalAnniversaries = await query<AnnivRow>(
    "SELECT name, month, day, notice_days, duration_days, description FROM world_anniversaries WHERE character_id = ? ORDER BY month, day, id",
    [id]
  );
  const relationships = await query(
    `SELECT d.title AS targetTitle, d.category AS targetCategory, r.relation
     FROM character_relationships r JOIN world_dictionary d ON d.id = r.target_entry_id
     WHERE r.character_id = ? ORDER BY r.id`,
    [id]
  );
  const illustrations = await query(
    "SELECT kind, url, description, trigger_condition, sort_order FROM illustrations WHERE character_id = ? ORDER BY kind, sort_order, id",
    [id]
  );
  return {
    format: CHARACTER_FORMAT,
    name: c.name,
    profile: c.profile,
    personality: c.personality,
    speech_style: c.speech_style,
    ai_prompt: c.ai_prompt,
    scenario: c.scenario,
    greeting: c.greeting,
    title_image_url: c.title_image_url,
    privateDictionary,
    personalAnniversaries,
    relationships,
    illustrations,
  };
}

/** 사전 항목 1건 INSERT (임베딩 실패 시 null). 성공 시 true */
async function insertDict(worldId: number, characterId: number | null, e: Record<string, unknown>, warnings: string[]) {
  const category = str(e.category);
  const title = str(e.title).trim();
  if (!CATEGORIES.includes(category) || !title) {
    warnings.push(`사전 항목 건너뜀(category/title 오류): ${title || "(제목 없음)"}`);
    return false;
  }
  const aliases = strOrNull(e.aliases);
  const content = str(e.content);
  let embedding: string | null = null;
  try {
    embedding = JSON.stringify(await embedPassage(`${title} ${aliases ?? ""} ${content}`));
  } catch (err) {
    console.error("import embedding error:", err);
    warnings.push(`임베딩 실패(키워드 검색만 적용): ${title}`);
  }
  await execute(
    `INSERT INTO world_dictionary (world_id, character_id, category, title, aliases, content, embedding, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [worldId, characterId, category, title.slice(0, 128), aliases?.slice(0, 255) ?? null, content, embedding]
  );
  return true;
}

/** 기념일 1건 INSERT (검증 실패는 경고 후 건너뜀) */
async function insertAnniv(worldId: number, characterId: number | null, e: unknown, warnings: string[]) {
  const parsed = parseAnniversaryInput(e);
  if ("error" in parsed) {
    warnings.push(`기념일 건너뜀(${str((e as Record<string, unknown>)?.name) || "이름 없음"}): ${parsed.error}`);
    return false;
  }
  const { name, month, day, notice_days, duration_days, description } = parsed.value;
  await execute(
    "INSERT INTO world_anniversaries (world_id, character_id, preset_id, name, month, day, notice_days, duration_days, description) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)",
    [worldId, characterId, name, month, day, notice_days, duration_days, description]
  );
  return true;
}

/** 세계관 import: 새 세계관 생성(비공개). format 불일치/이름 없음은 Error 던짐(호출부에서 400) */
export async function importWorld(data: unknown, ownerUserId: number | null): Promise<ImportResult> {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.format !== WORLD_FORMAT) throw new Error(`format 이 ${WORLD_FORMAT} 이 아닙니다.`);
  const name = str(d.name).trim();
  if (!name) throw new Error("name 은 필수입니다.");
  const warnings: string[] = [];
  const res = await execute(
    `INSERT INTO worlds (name, description, ai_prompt, title_image_key, title_image_url, owner_user_id, visibility, status, is_active)
     VALUES (?, ?, ?, NULL, ?, ?, 'private', 'active', 1)`,
    [name.slice(0, 128), str(d.description), str(d.ai_prompt), strOrNull(d.title_image_url), ownerUserId]
  );
  const id = res.insertId;
  let dictionary = 0;
  let anniversaries = 0;
  for (const e of arr(d.dictionary)) if (await insertDict(id, null, e, warnings)) dictionary++;
  for (const e of arr(d.anniversaries)) if (await insertAnniv(id, null, e, warnings)) anniversaries++;
  await invalidateChatContext();
  return { id, imported: { dictionary, anniversaries }, warnings };
}

/**
 * 캐릭터 import: 대상 세계관에 새 캐릭터 생성(비공개). 세계관 존재/권한 검증은 호출부에서.
 * 이름 중복이면 "{이름} (가져옴)" 으로 1회 재시도, 그래도 중복이면 Error.
 */
export async function importCharacter(data: unknown, worldId: number, ownerUserId: number | null): Promise<ImportResult> {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.format !== CHARACTER_FORMAT) throw new Error(`format 이 ${CHARACTER_FORMAT} 이 아닙니다.`);
  const baseName = str(d.name).trim();
  if (!baseName) throw new Error("name 은 필수입니다.");
  const warnings: string[] = [];

  let id = 0;
  const candidates = [baseName, `${baseName} (가져옴)`];
  for (let i = 0; i < candidates.length; i++) {
    const nm = candidates[i].slice(0, 128);
    const dup = await query("SELECT id FROM characters WHERE world_id = ? AND name = ? LIMIT 1", [worldId, nm]);
    if (dup.length > 0) continue;
    try {
      const res = await execute(
        `INSERT INTO characters (world_id, name, profile, personality, speech_style, ai_prompt, scenario, greeting,
                                 title_image_key, title_image_url, owner_user_id, visibility, status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'private', 'active', 1)`,
        [
          worldId, nm, str(d.profile), str(d.personality), str(d.speech_style), str(d.ai_prompt),
          strOrNull(d.scenario), strOrNull(d.greeting), strOrNull(d.title_image_url), ownerUserId,
        ]
      );
      id = res.insertId;
      if (i === 1) warnings.push(`이름 중복으로 "${nm}" 으로 생성됨`);
      break;
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY") continue; // 동시 요청 레이스
      throw e;
    }
  }
  if (!id) throw new Error("이 세계관에 같은 이름의 캐릭터가 이미 있습니다.");

  let privateDictionary = 0;
  let personalAnniversaries = 0;
  let illustrations = 0;
  let relationships = 0;
  for (const e of arr(d.privateDictionary)) if (await insertDict(worldId, id, e, warnings)) privateDictionary++;
  for (const e of arr(d.personalAnniversaries)) if (await insertAnniv(worldId, id, e, warnings)) personalAnniversaries++;

  // 일러스트: url 만 복사(storage_key 는 빈 문자열 — 파일 자체는 이관하지 않음)
  for (const il of arr(d.illustrations)) {
    const url = str(il.url).trim();
    if (!url) {
      warnings.push("일러스트 건너뜀(url 없음)");
      continue;
    }
    const tc = il.trigger_condition;
    const tcJson = tc == null || tc === "" ? null : typeof tc === "string" ? tc : JSON.stringify(tc);
    await execute(
      `INSERT INTO illustrations (character_id, kind, storage_key, url, description, trigger_condition, sort_order)
       VALUES (?, ?, '', ?, ?, ?, ?)`,
      [id, il.kind === "conditional" ? "conditional" : "basic", url, strOrNull(il.description), tcJson, Number(il.sort_order) || 0]
    );
    illustrations++;
  }

  // 관계: 대상 세계관의 공용 사전에서 title+category 매칭
  for (const r of arr(d.relationships)) {
    const title = str(r.targetTitle);
    const relation = str(r.relation);
    const hit = await query<{ id: number }>(
      "SELECT id FROM world_dictionary WHERE world_id = ? AND character_id IS NULL AND title = ? AND category = ? LIMIT 1",
      [worldId, title, str(r.targetCategory)]
    );
    if (hit.length === 0 || !relation) {
      warnings.push(`관계 대상 없음: ${title}`);
      continue;
    }
    await execute(
      `INSERT INTO character_relationships (character_id, target_entry_id, relation) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE relation = VALUES(relation)`,
      [id, hit[0].id, relation]
    );
    relationships++;
  }

  await invalidateChatContext();
  return { id, imported: { privateDictionary, personalAnniversaries, relationships, illustrations }, warnings };
}
