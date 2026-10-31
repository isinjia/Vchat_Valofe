import { query } from "./mysql";
import type { VideoProviderRow } from "./types";
import type { ReferenceImage } from "./image-gen";

const CREATE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000;
/** 생성 완료 대기 한도 — 영상 생성은 수 분 걸릴 수 있음 */
const POLL_DEADLINE_MS = 570_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;

/** 기본(또는 활성 첫) 영상 생성 프로바이더. 없으면 null */
export async function resolveVideoProvider(): Promise<VideoProviderRow | null> {
  const rows = await query<VideoProviderRow>(
    "SELECT * FROM video_providers WHERE is_active = 1 ORDER BY is_default DESC, id LIMIT 1"
  );
  return rows[0] ?? null;
}

/**
 * 영상을 1건 생성해 mp4 Buffer 로 반환한다.
 * video_providers 의 기본 프로바이더 사용 (openai: Sora videos API, gemini: Veo predictLongRunning).
 * ref 가 있으면 참조(첫 프레임) 이미지로 전달한다. 두 API 모두 참조 이미지는 1장만 지원.
 */
export async function generateVideo(prompt: string, ref?: ReferenceImage | null): Promise<Buffer> {
  const p = await resolveVideoProvider();
  if (!p) {
    throw new Error("영상 생성 AI 가 등록되지 않았습니다. 관리자 > LLM 관리 > 영상 생성 AI 에서 등록하세요.");
  }
  if (!p.api_key) throw new Error(`영상 생성 AI "${p.name}" 에 API 키가 등록되지 않았습니다.`);
  if (p.provider === "gemini") return generateVeo(p, prompt, ref ?? null);
  return generateSora(p, prompt, ref ?? null);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** OpenAI Sora / OpenAI 호환 videos API: 생성 → 폴링 → content 다운로드 */
async function generateSora(p: VideoProviderRow, prompt: string, ref: ReferenceImage | null): Promise<Buffer> {
  const base = (p.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${p.api_key}` };

  const form = new FormData();
  form.append("model", p.model);
  form.append("prompt", prompt);
  if (/^\d+x\d+$/.test(p.size.trim())) form.append("size", p.size.trim());
  if (Number(p.duration_seconds) > 0) form.append("seconds", String(Number(p.duration_seconds)));
  if (ref) {
    form.append("input_reference", new Blob([new Uint8Array(ref.data)], { type: ref.mimeType }), "reference.png");
  }
  const createRes = await fetch(`${base}/videos`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(`영상 생성 API 오류 (${createRes.status}): ${text.slice(0, 500)}`);
  }
  const job = (await createRes.json()) as { id?: string; status?: string };
  if (!job.id) throw new Error("영상 생성 작업 ID 를 받지 못했습니다.");

  const deadline = Date.now() + POLL_DEADLINE_MS;
  let status = job.status ?? "queued";
  while (status !== "completed") {
    if (status === "failed") throw new Error("영상 생성이 실패했습니다. (프로바이더 failed 응답)");
    if (Date.now() > deadline) throw new Error("영상 생성 대기 시간이 초과되었습니다. 잠시 후 다시 시도하세요.");
    await sleep(POLL_INTERVAL_MS);
    const poll = await fetch(`${base}/videos/${job.id}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!poll.ok) {
      const text = await poll.text().catch(() => "");
      throw new Error(`영상 생성 상태 조회 오류 (${poll.status}): ${text.slice(0, 300)}`);
    }
    const j = (await poll.json()) as { status?: string; error?: { message?: string } };
    if (j.status === "failed") {
      throw new Error(`영상 생성이 실패했습니다: ${j.error?.message ?? "원인 미상"}`);
    }
    status = j.status ?? status;
  }

  const content = await fetch(`${base}/videos/${job.id}/content`, {
    headers,
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!content.ok) throw new Error(`생성된 영상 다운로드 실패 (${content.status})`);
  return Buffer.from(await content.arrayBuffer());
}

/** Gemini Veo: predictLongRunning → operation 폴링 → 파일 다운로드 */
async function generateVeo(p: VideoProviderRow, prompt: string, ref: ReferenceImage | null): Promise<Buffer> {
  const base = (p.base_url || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const keyHeader = { "x-goog-api-key": p.api_key ?? "" };

  const instance: Record<string, unknown> = { prompt };
  if (ref) {
    instance.image = { bytesBase64Encoded: ref.data.toString("base64"), mimeType: ref.mimeType };
  }
  const parameters: Record<string, unknown> = { aspectRatio: sizeToVeoAspect(p.size) };
  if (Number(p.duration_seconds) > 0) parameters.durationSeconds = Number(p.duration_seconds);

  const createRes = await fetch(`${base}/v1beta/models/${p.model}:predictLongRunning`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...keyHeader },
    body: JSON.stringify({ instances: [instance], parameters }),
    signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(`Veo 영상 생성 오류 (${createRes.status}): ${text.slice(0, 500)}`);
  }
  const op = (await createRes.json()) as { name?: string };
  if (!op.name) throw new Error("Veo 작업(operation) 이름을 받지 못했습니다.");

  const deadline = Date.now() + POLL_DEADLINE_MS;
  let result: VeoOperation;
  for (;;) {
    if (Date.now() > deadline) throw new Error("영상 생성 대기 시간이 초과되었습니다. 잠시 후 다시 시도하세요.");
    await sleep(POLL_INTERVAL_MS);
    const poll = await fetch(`${base}/v1beta/${op.name}`, {
      headers: keyHeader,
      signal: AbortSignal.timeout(30_000),
    });
    if (!poll.ok) {
      const text = await poll.text().catch(() => "");
      throw new Error(`Veo 작업 조회 오류 (${poll.status}): ${text.slice(0, 300)}`);
    }
    const j = (await poll.json()) as VeoOperation;
    if (j.error) throw new Error(`영상 생성이 실패했습니다: ${j.error.message ?? "원인 미상"}`);
    if (j.done) {
      result = j;
      break;
    }
  }

  const uri =
    result.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
    result.response?.generatedVideos?.[0]?.video?.uri;
  if (!uri) throw new Error("Veo 가 영상을 반환하지 않았습니다. (모델이 영상 출력을 지원하는지 확인하세요)");
  const dl = await fetch(uri, { headers: keyHeader, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!dl.ok) throw new Error(`생성된 영상 다운로드 실패 (${dl.status})`);
  return Buffer.from(await dl.arrayBuffer());
}

interface VeoOperation {
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] };
    generatedVideos?: { video?: { uri?: string } }[];
  };
}

/** 'WxH' 또는 'n:m' 을 Veo aspectRatio 로 변환 — Veo 는 16:9 / 9:16 만 지원 */
function sizeToVeoAspect(size: string): string {
  const s = size.trim();
  let ratio = 1;
  const m = /^(\d+)x(\d+)$/.exec(s);
  const r = /^(\d+):(\d+)$/.exec(s);
  if (m) ratio = Number(m[1]) / Number(m[2]);
  else if (r) ratio = Number(r[1]) / Number(r[2]);
  return ratio >= 1 ? "16:9" : "9:16";
}
