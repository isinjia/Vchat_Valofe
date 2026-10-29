/**
 * scripts/haru-common-entries.json (하루 청크에서 추출한 공용 정보)를
 * 소울워커 세계관(id 2)의 공용 사전으로 삽입한다. (하루 전용 원본은 유지)
 * - 같은 제목의 공용 항목이 이미 있으면 건너뜀 (재실행 안전)
 * - 별칭은 같은 제목의 하루 전용 항목에서 복사 (검색어 재활용)
 * 실행: npx tsx scripts/insert-common-entries.ts
 */
import fs from "fs";
import path from "path";
import {
  query,
  execute,
  embedPassage,
  getPool,
  getRedis,
  invalidateChatContext,
} from "../packages/core/src/index";

const WORLD_ID = 2;

interface CommonEntry {
  title: string;
  category: "person" | "term" | "location";
  common: string | null;
}

async function main() {
  const file = path.resolve(__dirname, "haru-common-entries.json");
  const entries: CommonEntry[] = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`입력 ${entries.length}건 (common null ${entries.filter((e) => !e.common).length}건)`);

  let inserted = 0;
  let skipped = 0;
  let embedded = 0;
  for (const e of entries) {
    if (!e.common || !e.common.trim()) continue;
    const title = e.title.trim().slice(0, 128);

    const exists = await query<{ id: number }>(
      "SELECT id FROM world_dictionary WHERE world_id = ? AND character_id IS NULL AND title = ?",
      [WORLD_ID, title]
    );
    if (exists.length > 0) {
      skipped++;
      continue;
    }

    // 같은 제목의 하루 전용 항목에서 별칭(검색어) 복사
    const src = await query<{ aliases: string | null }>(
      "SELECT aliases FROM world_dictionary WHERE world_id = ? AND character_id IS NOT NULL AND title = ? LIMIT 1",
      [WORLD_ID, title]
    );
    const aliases = src[0]?.aliases ?? null;

    let embedding: string | null = null;
    try {
      embedding = JSON.stringify(await embedPassage(`${title} ${aliases ?? ""} ${e.common}`));
      embedded++;
    } catch (err) {
      console.error(`임베딩 실패(${title}):`, (err as Error).message);
    }
    await execute(
      `INSERT INTO world_dictionary (world_id, character_id, category, title, aliases, content, embedding, sort_order)
       VALUES (?, NULL, ?, ?, ?, ?, ?, 0)`,
      [WORLD_ID, e.category, title, aliases, e.common.trim(), embedding]
    );
    inserted++;
    if (inserted % 20 === 0) console.log(`  ${inserted}건 삽입...`);
  }

  await invalidateChatContext();
  console.log(`완료: 삽입 ${inserted}건(임베딩 ${embedded}), 기존 중복 건너뜀 ${skipped}건`);
  getRedis().disconnect();
  await getPool().end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
