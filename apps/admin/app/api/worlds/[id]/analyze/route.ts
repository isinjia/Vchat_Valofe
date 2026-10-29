import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4"; // SDK 헬퍼가 zod v4 API 필요 (zod 3.25 에 v4 서브패스 포함)
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getLlmSettings } from "@vchatbot/core";

export const runtime = "nodejs";

const client = new Anthropic();

const ALLOWED_EXT = [".txt", ".csv", ".tsv", ".json", ".xml", ".md", ".yaml", ".yml"];
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const CHUNK_CHARS = 10_000;
const MAX_CHUNKS = 30;

const ExtractionSchema = z.object({
  entries: z.array(
    z.object({
      category: z.enum(["location", "person", "term"]),
      title: z.string(),
      aliases: z.string().nullable(), // 쉼표 구분 별칭, 없으면 null
      content: z.string(),
    })
  ),
});

type Entry = z.infer<typeof ExtractionSchema>["entries"][number];

const SYSTEM_PROMPT = `당신은 게임 데이터 분석가다. 주어진 게임 데이터(테이블, 설정 텍스트, 로컬라이징 문자열 등)에서 세계관 사전에 넣을 가치가 있는 항목을 추출하라.
- category: location=지역/장소, person=인물/NPC/세력 인물, term=용어/아이템/시스템/종족/세력.
- title: 정식 명칭 1개.
- aliases: 데이터에 등장하는 다른 표기(쉼표 구분, 없으면 null).
- content: 데이터에서 알 수 있는 사실만으로 1~3문장 한국어 설명. 수치 밸런스 나열 금지, 추측 금지.
순수 수치 데이터, ID, 중복 항목은 제외하고, 세계관 이해에 의미 있는 항목만 추출하라.`;

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** 줄 경계 기준으로 최대 maxChars 길이 청크로 분할 (한 줄이 maxChars 초과면 강제 분할) */
function splitChunks(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) chunks.push(cur);
    cur = "";
  };
  for (const line of text.split("\n")) {
    let rest = line;
    while (rest.length > maxChars) {
      flush();
      chunks.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    const add = cur ? "\n" + rest : rest;
    if (cur.length + add.length > maxChars) {
      flush();
      cur = rest;
    } else {
      cur += add;
    }
  }
  flush();
  return chunks;
}

/**
 * POST /api/worlds/:id/analyze  (multipart: files[])
 * SSE 스트림 응답:
 *   {type:"start", totalChunks}
 *   {type:"progress", chunk, totalChunks}
 *   {type:"entries", entries:[...]}   새로 추가/교체된 항목만
 *   {type:"warning", message}
 *   {type:"done", total} / {type:"error", message}
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (files.length === 0) {
    return Response.json({ error: "files 가 필요합니다." }, { status: 400 });
  }

  const warnings: string[] = [];
  const parts: string[] = [];
  let totalBytes = 0;
  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (!ALLOWED_EXT.some((ext) => lower.endsWith(ext))) {
      warnings.push(`지원하지 않는 확장자라 건너뜀: ${file.name}`);
      continue;
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return Response.json({ error: "파일 합계가 5MB 를 초과합니다." }, { status: 400 });
    }
    parts.push(`=== 파일: ${file.name} ===\n${await file.text()}`);
  }
  if (parts.length === 0) {
    return Response.json({ error: "분석 가능한 파일이 없습니다." }, { status: 400 });
  }

  let chunks = splitChunks(parts.join("\n"), CHUNK_CHARS);
  if (chunks.length > MAX_CHUNKS) {
    warnings.push(`데이터가 너무 커서 앞 ${MAX_CHUNKS}개 청크(전체 ${chunks.length}개)만 처리합니다.`);
    chunks = chunks.slice(0, MAX_CHUNKS);
  }

  const llm = await getLlmSettings();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sse(data)));
      const found = new Map<string, Entry>(); // (category + title) -> 항목
      try {
        send({ type: "start", totalChunks: chunks.length });
        for (const w of warnings) send({ type: "warning", message: w });

        // 청크는 rate limit 보호를 위해 순차 처리
        for (let i = 0; i < chunks.length; i++) {
          try {
            const response = await client.messages.parse({
              model: llm.model,
              max_tokens: 16000,
              system: SYSTEM_PROMPT,
              messages: [{ role: "user", content: chunks[i] }],
              output_config: { format: zodOutputFormat(ExtractionSchema) },
            });
            const parsed = response.parsed_output;
            if (!parsed) {
              send({ type: "warning", message: `청크 ${i + 1}: 결과를 해석하지 못해 건너뜀` });
            } else {
              const changed: Entry[] = [];
              for (const e of parsed.entries) {
                const title = e.title.trim();
                if (!title) continue;
                const key = `${e.category}\u0000${title}`;
                const prev = found.get(key);
                // 중복이면 content 가 더 긴 쪽 유지
                if (prev && prev.content.length >= e.content.length) continue;
                const entry = { ...e, title };
                found.set(key, entry);
                changed.push(entry);
              }
              if (changed.length > 0) send({ type: "entries", entries: changed });
            }
          } catch (err) {
            if (err instanceof Anthropic.APIError) {
              if (err.status === 401) {
                send({ type: "error", message: `AI 인증 오류 (401): ${err.message}` });
                controller.close();
                return;
              }
              send({ type: "warning", message: `청크 ${i + 1}: AI 호출 오류 (${err.status}) ${err.message}` });
            } else {
              throw err;
            }
          }
          send({ type: "progress", chunk: i + 1, totalChunks: chunks.length });
        }
        send({ type: "done", total: found.size });
        controller.close();
      } catch (err) {
        console.error("analyze error:", err);
        try {
          send({ type: "error", message: "분석 중 오류가 발생했습니다." });
          controller.close();
        } catch {
          // 이미 닫힌 경우 무시
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
