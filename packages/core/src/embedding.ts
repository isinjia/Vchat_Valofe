import { pipeline } from "@huggingface/transformers";

const MODEL_ID = "Xenova/multilingual-e5-small";

type Extractor = (
  text: string,
  opts: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: ArrayLike<number> }>;

// Next.js dev 핫리로드 시 모델이 중복 로드되지 않도록 globalThis 에 캐시 (Promise 를 캐시해 동시 호출도 1회 로드)
const g = globalThis as unknown as { __vchatbotEmbedder?: Promise<Extractor> };

function getEmbedder(): Promise<Extractor> {
  if (!g.__vchatbotEmbedder) {
    const p = (pipeline("feature-extraction", MODEL_ID) as unknown as Promise<Extractor>).catch(
      (err) => {
        g.__vchatbotEmbedder = undefined; // 실패 시 다음 호출에서 재시도
        throw err;
      }
    );
    g.__vchatbotEmbedder = p;
  }
  return g.__vchatbotEmbedder;
}

async function embed(text: string): Promise<number[]> {
  const extractor = await getEmbedder();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

/** 사전 항목(문서)용 임베딩. e5 규약상 "passage: " prefix */
export function embedPassage(text: string): Promise<number[]> {
  return embed(`passage: ${text}`);
}

/** 대화(질의)용 임베딩. e5 규약상 "query: " prefix */
export function embedQuery(text: string): Promise<number[]> {
  return embed(`query: ${text}`);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
