/**
 * 하루 목소리: 문장 하나를 받아 하루 음성 서버(지피티 소비츠, 하루 목소리로 학습)에 넘기고 wav 를 돌려준다.
 * 음성 서버는 방송하는 컴퓨터에서 따로 띄운다 (HARU_TTS_URL, 기본 http://127.0.0.1:9880).
 * 기준 음성(말투 견본)은 서버 쪽 경로라 환경 변수로 둔다: HARU_TTS_REF(wav 경로), HARU_TTS_REF_TEXT(그 대사 글).
 * HARU_TTS_REF_MAP(json 경로)이 있으면 문장 끝말(군요·까요·죠·고요·게요·네요…)에 맞는 하루 대사를 기준 음성으로 쓴다 —
 * 끝말 억양은 기준 음성을 많이 따라가서, 같은 끝말로 끝나는 원본 대사를 견본으로 주면 하루다운 맺음이 나온다.
 */
import { readFileSync, statSync } from "node:fs";
import { loadEnv } from "@vchatbot/core";

export const dynamic = "force-dynamic";

const MAX_LEN = 200;

type RefRule = { end: string; question?: boolean; ref: string; text: string };
let refMap: { path: string; mtime: number; rules: { re: RegExp; question?: boolean; ref: string; text: string }[] } | null = null;

/** 끝말 표를 읽는다 (파일이 바뀌면 다시 읽음) */
function endingRules(path: string) {
  try {
    const mtime = statSync(path).mtimeMs;
    if (refMap?.path !== path || refMap.mtime !== mtime) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { rules?: RefRule[] };
      const rules = (raw.rules ?? []).map((r) => ({ ...r, re: new RegExp(`(${r.end})$`) }));
      refMap = { path, mtime, rules };
    }
    return refMap.rules;
  } catch {
    return [];
  }
}

/** 영어 낱말 읽기 (한국어 음성 모델은 영어 글자를 엉뚱하게 읽는다: PvP → "피리피") */
const EN_WORDS: Record<string, string> = {
  ok: "오케이", okay: "오케이", pvp: "피브이피", pve: "피브이이", boss: "보스", game: "게임", stream: "스트림",
  live: "라이브", chat: "채팅", lol: "롤", ai: "에이아이", vs: "대", hp: "에이치피", mp: "엠피", exp: "경험치",
  lv: "레벨", level: "레벨", sns: "에스엔에스", pc: "피시", tv: "티비", wow: "와우", hi: "하이", bye: "바이",
};
const EN_LETTERS: Record<string, string> = {
  a: "에이", b: "비", c: "씨", d: "디", e: "이", f: "에프", g: "지", h: "에이치", i: "아이", j: "제이", k: "케이", l: "엘", m: "엠",
  n: "엔", o: "오", p: "피", q: "큐", r: "알", s: "에스", t: "티", u: "유", v: "브이", w: "더블유", x: "엑스", y: "와이", z: "제트",
};

function speechText(text: string): string {
  return text.replace(/[a-zA-Z]+/g, (w) => EN_WORDS[w.toLowerCase()] ?? [...w.toLowerCase()].map((c) => EN_LETTERS[c]).join(""));
}

/** wav 길이(초) — 헤더의 data 덩어리 크기로 잰다 */
function wavSeconds(buf: ArrayBuffer): number {
  const v = new DataView(buf);
  let sr = 32000, ch = 1, bits = 16;
  for (let p = 12; p + 8 <= v.byteLength; ) {
    const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
    const size = v.getUint32(p + 4, true);
    if (id === "fmt ") { ch = v.getUint16(p + 10, true); sr = v.getUint32(p + 12, true); bits = v.getUint16(p + 22, true); }
    if (id === "data") return Math.min(size, v.byteLength - p - 8) / (sr * ch * (bits / 8));
    p += 8 + size + (size & 1);
  }
  return 0;
}

/** 음절당 길이가 이 범위를 벗어나면 깨진 것(뒤가 통째로 빠짐·웅얼거림)으로 보고 다시 만든다 */
const SEC_PER_SYL = [0.2, 0.6];
const TRIES = 3;

/** 문장 끝말에 맞는 기준 음성. 맞는 게 없으면 null */
function refForEnding(text: string, path: string | undefined) {
  if (!path) return null;
  const question = /\?["'」』)]*\s*$/.test(text);
  const tail = text.replace(/[\s.!?…~"'」』)]+$/, "");
  return endingRules(path).find((r) => r.re.test(tail) && (r.question == null || r.question === question)) ?? null;
}

export async function POST(req: Request) {
  loadEnv();
  const base = process.env.HARU_TTS_URL ?? "http://127.0.0.1:9880";
  // 말 빠르기(1 이 학습 그대로, 지금 1.03 — 사용자가 3% 빠르게 고름). 1 아래로 늘이면 발음이 뭉개져 술 취한 소리가 나니, 차분함은 기준 음성과 문장 사이 쉼으로 낸다
  const speed = Number(process.env.HARU_TTS_SPEED) || 1;
  if (!process.env.HARU_TTS_REF) return Response.json({ error: "하루 음성 설정(HARU_TTS_REF)이 없습니다." }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = String(body?.text ?? "").trim().slice(0, MAX_LEN);
  if (!/[가-힣a-zA-Z0-9]/.test(text)) return Response.json({ error: "읽을 글이 없습니다." }, { status: 400 });
  const ending = refForEnding(text, process.env.HARU_TTS_REF_MAP);
  const ref = ending?.ref ?? process.env.HARU_TTS_REF!;
  const refText = ending?.text ?? process.env.HARU_TTS_REF_TEXT ?? "";

  const spoken = speechText(text);
  const syl = (spoken.match(/[가-힣0-9]/g) ?? []).length;
  let best: { buf: ArrayBuffer; off: number } | null = null;
  for (let i = 0; i < TRIES; i++) {
    const r = await synth(base, spoken, ref, refText, speed);
    if (r instanceof Response) {
      if (best) break;
      return r;
    }
    // 짧은 말(4음절 미만)은 길이로 판단하기 어려워 그대로 쓴다
    const per = syl >= 4 ? wavSeconds(r) / syl : 0.33;
    const off = per < SEC_PER_SYL[0] ? SEC_PER_SYL[0] - per : per > SEC_PER_SYL[1] ? per - SEC_PER_SYL[1] : 0;
    if (!best || off < best.off) best = { buf: r, off };
    if (off === 0) break;
  }
  return new Response(best!.buf, { headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
}

/** 음성 서버에 한 번 만들어 달라고 한다. 실패하면 오류 응답 */
async function synth(base: string, text: string, ref: string, refText: string, speed: number): Promise<ArrayBuffer | Response> {
  let res: Response;
  try {
    res = await fetch(`${base}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        text_lang: "ko",
        ref_audio_path: ref,
        prompt_text: refText,
        prompt_lang: "ko",
        text_split_method: "cut0", // 문장은 브라우저에서 이미 나눠 보낸다
        batch_size: 1,
        media_type: "wav",
        streaming_mode: false,
        speed_factor: speed,
        top_k: 5,
        top_p: 1,
        temperature: 0.6, // 낮춰야 발음이 덜 뭉개진다 (1 에서는 뭉개진다는 평)
        repetition_penalty: 1.35,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return Response.json({ error: "하루 음성 서버에 연결하지 못했습니다." }, { status: 502 });
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    return Response.json({ error: `하루 음성 서버 오류 ${res.status}`, detail: msg.slice(0, 300) }, { status: 502 });
  }
  return res.arrayBuffer();
}
