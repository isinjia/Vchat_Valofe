const QUEUE_URL = (process.env.QUEUE_URL || "").replace(/\/$/, "");
const WORKER_TOKEN = process.env.QUEUE_WORKER_TOKEN || "";
const LMSTUDIO_URL = (process.env.LMSTUDIO_URL || "http://192.168.10.163:1234/v1").replace(/\/$/, "");
const LMSTUDIO_API_KEY = process.env.LMSTUDIO_API_KEY || "";
const LMSTUDIO_MODEL = process.env.LMSTUDIO_MODEL || "";
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1));

if (!QUEUE_URL || !WORKER_TOKEN) {
  console.error("[worker] QUEUE_URL 과 QUEUE_WORKER_TOKEN 은 필수입니다.");
  process.exit(1);
}

const FLUSH_MS = 250;
const FLUSH_BYTES = 2048;
let stopping = false;

const log = (msg: string) => console.log(`${new Date().toISOString()} [worker] ${msg}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const authHeaders = { Authorization: `Bearer ${WORKER_TOKEN}` };

interface Job {
  id: string;
  payload: { model: string; max_tokens: number; messages: { role: string; content: string }[] };
}

async function postJson(path: string, body: unknown): Promise<number> {
  const res = await fetch(`${QUEUE_URL}${path}`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await res.text().catch(() => "");
  return res.status;
}

async function processJob(job: Job) {
  const abort = new AbortController();
  let gone = false;
  let seq = 0;
  let buffer = "";
  let lastFlush = Date.now();
  let finishReason = "stop";
  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  let outChars = 0;

  // 순차 전송 보장: 하나씩 await
  const flush = async () => {
    if (!buffer || gone) return;
    const content = buffer;
    buffer = "";
    lastFlush = Date.now();
    const status = await postJson(`/worker/jobs/${job.id}/chunks`, { seq: seq++, content });
    if (status === 410) {
      gone = true;
      abort.abort();
    }
  };

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (LMSTUDIO_API_KEY) headers.Authorization = `Bearer ${LMSTUDIO_API_KEY}`;
    const res = await fetch(`${LMSTUDIO_URL}/chat/completions`, {
      method: "POST",
      headers,
      signal: abort.signal,
      body: JSON.stringify({
        model: LMSTUDIO_MODEL || job.payload.model,
        max_tokens: job.payload.max_tokens,
        stream: true,
        stream_options: { include_usage: true },
        messages: job.payload.messages,
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`LM Studio 오류 (${res.status}): ${text.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finished = false;
    while (!finished && !gone) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          finished = true;
          break;
        }
        let j: {
          choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        };
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.usage && typeof j.usage.prompt_tokens === "number") {
          usage = { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens ?? 0 };
        }
        const c = j.choices?.[0];
        if (c?.delta?.content) {
          buffer += c.delta.content;
          outChars += c.delta.content.length;
        }
        if (c?.finish_reason) finishReason = c.finish_reason;
        if (buffer.length >= FLUSH_BYTES || Date.now() - lastFlush >= FLUSH_MS) await flush();
        if (gone) break;
      }
    }
    reader.cancel().catch(() => {});
    if (gone) {
      log(`job ${job.id} abandoned (410)`);
      return;
    }
    await flush();
    if (gone) {
      log(`job ${job.id} abandoned (410)`);
      return;
    }
    if (!usage.completion_tokens) usage.completion_tokens = Math.ceil(outChars / 2); // usage 미제공 시 추정
    await postJson(`/worker/jobs/${job.id}/done`, { finish_reason: finishReason, usage });
    log(`job ${job.id} done`);
  } catch (e) {
    if (gone) {
      log(`job ${job.id} abandoned (410)`);
      return;
    }
    const message = (e as Error).message || "unknown error";
    log(`job ${job.id} failed: ${message.slice(0, 200)}`);
    await postJson(`/worker/jobs/${job.id}/error`, { message }).catch(() => {});
  }
}

async function loop(n: number) {
  while (!stopping) {
    let job: Job | null = null;
    try {
      const res = await fetch(`${QUEUE_URL}/worker/jobs/next?wait=25`, { headers: authHeaders });
      if (res.status === 200) job = (await res.json()) as Job;
      else {
        await res.text().catch(() => "");
        if (res.status !== 204) {
          log(`poll status ${res.status}`);
          await sleep(3000);
        }
      }
    } catch (e) {
      log(`poll error: ${(e as Error).message}`);
      await sleep(3000);
    }
    if (job) {
      log(`loop#${n} job ${job.id} received`);
      await processJob(job);
    }
  }
}

process.on("SIGINT", () => {
  if (stopping) process.exit(1);
  stopping = true;
  log("종료 요청 — 진행 중 작업을 마친 뒤 종료합니다.");
});

log(`start: queue=${QUEUE_URL} lmstudio=${LMSTUDIO_URL} concurrency=${CONCURRENCY}`);
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => loop(i)));
log("bye");
export {};
