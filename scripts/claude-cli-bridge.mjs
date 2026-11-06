#!/usr/bin/env node
/**
 * Claude Code CLI 중계 서버 (로컬 개발용)
 *
 * 이 PC에 로그인된 Claude Code(`claude -p`)를 OpenAI 호환 chat/completions 주소로 감싼다.
 * API 키 없이 Claude를 쓰기 위한 용도이며, 관리툴 > LLM 에 아래처럼 등록해서 쓴다.
 *   종류: openai_compatible / base_url: http://127.0.0.1:8790/v1 / 모델: sonnet (또는 opus, haiku)
 *
 * 실행:  node scripts/claude-cli-bridge.mjs            (포트 기본 8790, 환경변수 CLAUDE_BRIDGE_PORT 로 변경)
 * 의존성 없음. 운영 배포용이 아니다 — 이 PC에서 개발/콘텐츠 제작할 때만 쓴다.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 8790);
const DEFAULT_MODEL = process.env.CLAUDE_BRIDGE_MODEL || "sonnet";
/** 시스템 프롬프트가 이보다 길면 명령줄 인자 대신 본문(stdin)에 넣는다 (윈도우 명령줄 길이 제한 회피) */
const SYSTEM_ARG_LIMIT = 8000;

function findClaude() {
  if (process.env.CLAUDE_BRIDGE_BIN) return process.env.CLAUDE_BRIDGE_BIN;
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "claude.exe"),
    path.join(os.homedir(), ".local", "bin", "claude"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return "claude"; // PATH 에서 찾기
}
const CLAUDE_BIN = findClaude();

/** OpenAI 메시지 배열 → (시스템 프롬프트, 본문 프롬프트) */
function buildPrompt(messages) {
  const systemParts = [];
  const turns = [];
  for (const m of messages ?? []) {
    const content = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content) ? m.content.map((p) => p?.text ?? "").join("") : "";
    if (m.role === "system") systemParts.push(content);
    else if (m.role === "user" || m.role === "assistant") turns.push({ role: m.role, content });
  }
  let system = systemParts.join("\n\n");
  let prompt;
  if (turns.length <= 1) {
    prompt = turns[0]?.content ?? "";
  } else {
    // claude -p 는 한 번에 한 프롬프트만 받으므로 이전 대화를 기록 형태로 넣는다
    const history = turns.slice(0, -1)
      .map((t) => `[${t.role === "user" ? "유저" : "당신(assistant)"}]\n${t.content}`)
      .join("\n\n");
    const last = turns[turns.length - 1];
    prompt =
      `아래는 지금까지의 대화 기록이다. 기록을 이어받아, 마지막 유저 발화에 대한 당신(assistant)의 다음 답변만 작성하라. ` +
      `역할 표시([유저], [당신]) 같은 머리말은 붙이지 마라.\n\n===== 대화 기록 =====\n${history}\n\n` +
      `===== 마지막 유저 발화 =====\n${last.role === "user" ? last.content : "(계속)"}`;
  }
  if (system.length > SYSTEM_ARG_LIMIT) {
    prompt = `===== 시스템 지침 (최우선으로 따를 것) =====\n${system}\n\n===== 요청 =====\n${prompt}`;
    system = "아래 본문의 '시스템 지침' 단락을 시스템 프롬프트로 간주하고 최우선으로 따르라.";
  }
  return { system, prompt };
}

/** claude -p 를 띄워 텍스트 델타를 콜백으로 흘린다. 끝나면 usage/stop_reason 을 resolve */
function runClaude({ model, system, prompt, onDelta }) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--model", model,
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--tools", "",
      "--no-session-persistence",
    ];
    if (system) args.push("--system-prompt", system);

    const env = { ...process.env, ENABLE_TOOL_SEARCH: "false" };
    // Claude Code 세션 안에서 띄웠을 때 중첩 실행으로 막히지 않도록 표식을 지운다
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const child = spawn(CLAUDE_BIN, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    let gotText = false;
    let result = { model, stopReason: "stop", usage: null };

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "stream_event") {
          const e = ev.event;
          if (e?.type === "message_start" && e.message?.model) result.model = e.message.model;
          if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
            gotText = true;
            onDelta(e.delta.text);
          }
          if (e?.type === "message_delta") {
            if (e.delta?.stop_reason) result.stopReason = e.delta.stop_reason === "max_tokens" ? "length" : "stop";
            if (e.usage) result.usage = e.usage;
          }
        } else if (ev.type === "result") {
          if (ev.usage) result.usage = ev.usage;
          if (ev.is_error || ev.subtype?.startsWith("error")) {
            stderr += `\n[result] ${ev.subtype ?? ""} ${typeof ev.result === "string" ? ev.result : ""}`;
          }
        }
      }
    });
    child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    child.on("error", (err) => reject(new Error(`claude 실행 실패: ${err.message} (경로: ${CLAUDE_BIN})`)));
    child.on("close", (code) => {
      if (code !== 0 && !gotText) {
        reject(new Error(`claude 종료코드 ${code}: ${stderr.trim().slice(0, 800) || "출력 없음"}`));
      } else {
        resolve(result);
      }
    });
    child.stdin.end(prompt, "utf8");
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function toUsage(u) {
  if (!u) return undefined;
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return { prompt_tokens: input, completion_tokens: u.output_tokens ?? 0, total_tokens: input + (u.output_tokens ?? 0) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, claude: CLAUDE_BIN, defaultModel: DEFAULT_MODEL }));
  }
  if (req.method === "GET" && url.pathname === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: ["sonnet", "opus", "haiku"].map((id) => ({ id, object: "model" })) }));
  }
  if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "not found" } }));
  }

  let body;
  try { body = await readJson(req); }
  catch { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "bad json" } })); }

  const model = body.model || DEFAULT_MODEL;
  const { system, prompt } = buildPrompt(body.messages);
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const stream = body.stream !== false;
  console.log(`[bridge] ${new Date().toISOString()} model=${model} system=${system.length}자 prompt=${prompt.length}자 stream=${stream}`);

  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    let modelName = model;
    try {
      const result = await runClaude({
        model, system, prompt,
        onDelta: (text) => send({ id, object: "chat.completion.chunk", created, model: modelName, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }),
      });
      modelName = result.model;
      send({ id, object: "chat.completion.chunk", created, model: modelName, choices: [{ index: 0, delta: {}, finish_reason: result.stopReason }], usage: toUsage(result.usage) });
      res.write("data: [DONE]\n\n");
    } catch (err) {
      console.error("[bridge] 오류:", err.message);
      // 본문이 이미 시작됐으므로 오류를 텍스트로 흘리고 종료
      send({ id, object: "chat.completion.chunk", created, model: modelName, choices: [{ index: 0, delta: { content: `[Claude 중계 오류] ${err.message}` }, finish_reason: "stop" }] });
      res.write("data: [DONE]\n\n");
    }
    return res.end();
  }

  try {
    let text = "";
    const result = await runClaude({ model, system, prompt, onDelta: (t) => { text += t; } });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id, object: "chat.completion", created, model: result.model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: result.stopReason }],
      usage: toUsage(result.usage),
    }));
  } catch (err) {
    console.error("[bridge] 오류:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: err.message } }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[bridge] Claude Code 중계 서버 http://127.0.0.1:${PORT}/v1  (claude: ${CLAUDE_BIN}, 기본 모델: ${DEFAULT_MODEL})`);
});
