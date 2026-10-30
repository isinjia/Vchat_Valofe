import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.QUEUE_PORT || 8600);
const WORKER_TOKEN = process.env.QUEUE_WORKER_TOKEN || "";
const CLIENT_TOKEN = process.env.QUEUE_CLIENT_TOKEN || "";
const MAX_PENDING = Number(process.env.QUEUE_MAX_PENDING || 100);
const WAIT_TIMEOUT_MS = Number(process.env.QUEUE_WAIT_TIMEOUT_MS || 180_000);
const STALL_TIMEOUT_MS = Number(process.env.QUEUE_STALL_TIMEOUT_MS || 60_000);
const RETAIN_MS = 60_000;
const KEEPALIVE_MS = 15_000;
const MAX_BODY = 4 * 1024 * 1024;

if (!WORKER_TOKEN) {
  console.error("[queue] QUEUE_WORKER_TOKEN 이 설정되지 않았습니다. 종료합니다.");
  process.exit(1);
}

type JobState = "pending" | "processing" | "done" | "cancelled" | "error" | "expired";

interface ChatMessage {
  role: string;
  content: string;
}

interface Job {
  id: string;
  state: JobState;
  stream: boolean;
  model: string;
  maxTokens: number;
  messages: ChatMessage[];
  res: http.ServerResponse;
  created: number;
  text: string;
  waitTimer?: NodeJS.Timeout;
  stallTimer?: NodeJS.Timeout;
  keepAlive?: NodeJS.Timeout;
}

const jobs = new Map<string, Job>();
const pending: Job[] = [];
interface Waiter {
  res: http.ServerResponse;
  timer: NodeJS.Timeout;
}
const waiters: Waiter[] = [];

const log = (msg: string) => console.log(`${new Date().toISOString()} [queue] ${msg}`);

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function bearer(req: http.IncomingMessage): string {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  const s = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on("end", () => {
      try {
        const t = Buffer.concat(parts).toString("utf8");
        resolve(t ? JSON.parse(t) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function isActive(j: Job | undefined): j is Job {
  return !!j && (j.state === "pending" || j.state === "processing");
}

function sse(job: Job, data: unknown) {
  if (job.res.writableEnded || job.res.destroyed) return;
  job.res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

function chunkObj(job: Job, delta: Record<string, unknown>, finish: string | null) {
  return {
    id: job.id,
    object: "chat.completion.chunk",
    created: Math.floor(job.created / 1000),
    model: job.model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

/** 종료 공통 처리: 타이머 제거, 60초 후 레코드 삭제 */
function settle(job: Job, state: JobState) {
  job.state = state;
  clearTimeout(job.waitTimer);
  clearTimeout(job.stallTimer);
  clearInterval(job.keepAlive);
  const idx = pending.indexOf(job);
  if (idx >= 0) pending.splice(idx, 1);
  setTimeout(() => jobs.delete(job.id), RETAIN_MS).unref();
}

function fail(job: Job, state: "error" | "expired", message: string, status: number) {
  if (!isActive(job)) return;
  settle(job, state);
  if (job.stream) {
    if (!job.res.writableEnded) {
      job.res.write(`event: error\ndata: ${JSON.stringify({ error: { message } })}\n\n`);
      job.res.end();
    }
  } else {
    json(job.res, status, { error: { message } });
  }
}

function armStall(job: Job) {
  clearTimeout(job.stallTimer);
  job.stallTimer = setTimeout(() => {
    log(`job ${job.id} stall timeout`);
    fail(job, "expired", "worker stalled", 504);
  }, STALL_TIMEOUT_MS);
}

function assign(job: Job, w: Waiter) {
  clearTimeout(w.timer);
  job.state = "processing";
  armStall(job);
  log(`job ${job.id} assigned`);
  json(w.res, 200, {
    id: job.id,
    payload: { model: job.model, max_tokens: job.maxTokens, messages: job.messages },
  });
}

function dispatch() {
  while (pending.length && waiters.length) {
    const w = waiters.shift()!;
    if (w.res.destroyed || w.res.writableEnded) {
      clearTimeout(w.timer);
      continue;
    }
    assign(pending.shift()!, w);
  }
}

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse) {
  if (CLIENT_TOKEN && !safeEq(bearer(req), CLIENT_TOKEN)) {
    return json(res, 401, { error: { message: "unauthorized" } });
  }
  let body: any;
  try {
    body = await readBody(req);
  } catch (e) {
    return json(res, 400, { error: { message: (e as Error).message } });
  }
  if (!Array.isArray(body.messages)) {
    return json(res, 400, { error: { message: "messages required" } });
  }
  if (pending.length >= MAX_PENDING) {
    return json(res, 503, { error: { message: "queue full" } });
  }
  const job: Job = {
    id: randomUUID(),
    state: "pending",
    stream: body.stream === true,
    model: String(body.model ?? ""),
    maxTokens: Number(body.max_tokens) || 1024,
    messages: body.messages,
    res,
    created: Date.now(),
    text: "",
  };
  jobs.set(job.id, job);
  pending.push(job);
  log(`job ${job.id} created stream=${job.stream} pending=${pending.length}`);

  if (job.stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": queued\n\n");
    job.keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(": keepalive\n\n");
    }, KEEPALIVE_MS);
  }

  job.waitTimer = setTimeout(() => {
    log(`job ${job.id} wait timeout`);
    fail(job, "expired", "queue wait timeout", 504);
  }, WAIT_TIMEOUT_MS);

  // 클라이언트 연결 끊김 → 취소 (정상 종료된 경우는 이미 상태가 확정됨)
  res.on("close", () => {
    if (isActive(job)) {
      log(`job ${job.id} cancelled (client closed)`);
      settle(job, "cancelled");
    }
  });

  dispatch();
}

function handleNext(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  let wait = Number(url.searchParams.get("wait"));
  if (!Number.isFinite(wait) || wait <= 0) wait = 25;
  wait = Math.min(wait, 30);

  const w: Waiter = {
    res,
    timer: setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      if (!res.headersSent) {
        res.writeHead(204);
        res.end();
      }
    }, wait * 1000),
  };
  res.on("close", () => {
    clearTimeout(w.timer);
    const i = waiters.indexOf(w);
    if (i >= 0) waiters.splice(i, 1);
  });
  waiters.push(w);
  dispatch();
}

async function handleWorkerJob(req: http.IncomingMessage, res: http.ServerResponse, id: string, action: string) {
  let body: any;
  try {
    body = await readBody(req);
  } catch (e) {
    return json(res, 400, { error: { message: (e as Error).message } });
  }
  const job = jobs.get(id);
  if (!isActive(job)) return json(res, 410, { error: { message: "gone" } });

  if (action === "chunks") {
    const content = typeof body.content === "string" ? body.content : "";
    if (content) {
      if (job.stream) sse(job, chunkObj(job, { content }, null));
      else job.text += content;
    }
    armStall(job);
    return json(res, 200, { ok: true });
  }

  if (action === "done") {
    const usage = {
      prompt_tokens: Number(body.usage?.prompt_tokens) || 0,
      completion_tokens: Number(body.usage?.completion_tokens) || 0,
  };
    const finish = typeof body.finish_reason === "string" && body.finish_reason ? body.finish_reason : "stop";
    const total = { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens };
    settle(job, "done");
    if (job.stream) {
      sse(job, chunkObj(job, {}, finish));
      sse(job, {
        id: job.id,
        object: "chat.completion.chunk",
        created: Math.floor(job.created / 1000),
        model: job.model,
        choices: [],
        usage: total,
      });
      sse(job, "[DONE]");
      job.res.end();
    } else {
      json(job.res, 200, {
        id: job.id,
        object: "chat.completion",
        created: Math.floor(job.created / 1000),
        model: job.model,
        choices: [{ index: 0, message: { role: "assistant", content: job.text }, finish_reason: finish }],
        usage: total,
      });
    }
    log(`job ${job.id} done`);
    return json(res, 200, { ok: true });
  }

  if (action === "error") {
    log(`job ${job.id} worker error`);
    fail(job, "error", String(body.message ?? "worker error").slice(0, 500), 500);
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: { message: "not found" } });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  const method = req.method || "GET";

  const run = (p: Promise<unknown> | void) => {
    if (p) p.catch((e) => {
      log(`handler error: ${(e as Error).message}`);
      json(res, 500, { error: { message: "internal error" } });
    });
  };

  if (method === "GET" && path === "/healthz") {
    return json(res, 200, {
      ok: true,
      pending: pending.length,
      processing: [...jobs.values()].filter((j) => j.state === "processing").length,
    });
  }
  if (method === "POST" && path === "/v1/chat/completions") return run(handleChat(req, res));

  if (path.startsWith("/worker/")) {
    if (!safeEq(bearer(req), WORKER_TOKEN)) return json(res, 401, { error: { message: "unauthorized" } });
    if (method === "GET" && path === "/worker/jobs/next") return handleNext(req, res, url);
    const m = /^\/worker\/jobs\/([^/]+)\/(chunks|done|error)$/.exec(path);
    if (method === "POST" && m) return run(handleWorkerJob(req, res, m[1], m[2]));
  }
  json(res, 404, { error: { message: "not found" } });
});

server.listen(PORT, () => {
  log(`listening on :${PORT} (maxPending=${MAX_PENDING}, clientAuth=${CLIENT_TOKEN ? "on" : "off"})`);
});
