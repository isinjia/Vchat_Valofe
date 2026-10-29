import { cosineSimilarity } from "./embedding";
import type { DictionaryEntry } from "./types";

/** 표제어 또는 별칭(쉼표 구분) 중 하나라도 text 에 포함되면 true */
export function keywordMatch(entry: DictionaryEntry, text: string): boolean {
  const words = [entry.title, ...(entry.aliases ?? "").split(",")]
    .map((w) => w.trim())
    .filter(Boolean);
  return words.some((w) => text.includes(w));
}

/**
 * 키워드 매칭 항목(우선) + 임베딩 유사도 상위 항목을 합쳐 최대 topK 개 반환한다.
 * 반환 순서는 원래 사전 순서(category, sort_order)를 유지한다.
 */
export function selectRelevantEntries(
  entries: DictionaryEntry[],
  queryText: string,
  queryEmbedding: number[] | null,
  opts: { topK: number; minScore: number }
): DictionaryEntry[] {
  const picked = new Set<number>(); // entries 인덱스
  entries.forEach((e, i) => {
    if (picked.size < opts.topK && keywordMatch(e, queryText)) picked.add(i);
  });

  if (queryEmbedding) {
    const scored: { i: number; score: number }[] = [];
    entries.forEach((e, i) => {
      if (picked.has(i) || !e.embedding || e.embedding.length === 0) return;
      const score = cosineSimilarity(queryEmbedding, e.embedding);
      if (score >= opts.minScore) scored.push({ i, score });
    });
    scored.sort((a, b) => b.score - a.score);
    for (const { i } of scored) {
      if (picked.size >= opts.topK) break;
      picked.add(i);
    }
  }

  return entries.filter((_, i) => picked.has(i));
}
