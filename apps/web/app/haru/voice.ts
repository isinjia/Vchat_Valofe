/**
 * 하루 목소리 — 답변 글이 들어오는 대로 문장 단위로 끊어 /api/haru/tts(하루 음성 서버)로 소리를 만들고 차례로 재생한다.
 *  - 괄호 지문 "(웃으며)" 은 읽지 않는다 (입 모양 쪽 규칙과 같음)
 *  - 문장을 받는 즉시 소리를 주문하고, 앞 문장을 재생하는 동안 다음 문장을 미리 만든다
 *  - 재생을 시작할 때 AutoActor.speakLine 으로 그 문장의 입 모양을 소리 길이에 맞춰 돌리고,
 *    재생 중 소리 크기를 voiceLevel 로 넘겨 입 벌림을 실제 소리에 맞춘다
 *  - 새 메시지를 보내면 하던 말은 끊는다. 음성 서버가 없으면 그 문장은 소리 없이 입만 움직인다
 */
import type { ChatEvent } from "@/lib/chat-events";
import type { AutoActor } from "./auto-actor";

const STORE_KEY = "haru-voice-on";
const MIN_CHARS = 4; // 이보다 짧은 문장("네.")은 다음 문장과 붙여 읽는다
const MAX_CHARS = 90; // 끝맺음 없이 이만큼 길어지면 쉼표·띄어쓰기에서 끊는다
const SENTENCE_GAP = 0.45; // 문장과 문장 사이 숨 고르는 쉼(초) — 붙여 읽으면 다급하게 들린다
const QUESTION_GAP = 0.6; // 물음·느낌표 뒤에는 조금 더 쉰다
const SFX_URL = "/haru/sfx/"; // 말 아닌 소리(웃음·한숨·흠 등) — scripts/haru-sfx-export.py 가 만든다
const SFX_GAP = 1.2; // 소리와 소리 사이 최소 간격(초)
const SFX_VOLUME = 0.85;
const KEY_VOLUME = 0.18; // 키보드 소리 크기 (목소리보다 훨씬 작게)

interface Line {
  text: string;
  audio: Promise<AudioBuffer | null>;
}

/** 읽을 수 없는 글자(이모지·기호·자모 웃음 ㅋㅋ)를 빼고 공백을 정리 */
function cleanForSpeech(s: string): string {
  return s
    .replace(/[ㄱ-ㅎㅏ-ㅣ]+/g, " ")
    .replace(/[^가-힣a-zA-Z0-9\s.,!?~…'"]/g, " ")
    .replace(/~+/g, "~")
    .replace(/\s+/g, " ")
    .trim();
}

function speakable(s: string): number {
  return (s.match(/[가-힣a-zA-Z0-9]/g) ?? []).length;
}

export class HaruVoice {
  private enabledFlag: boolean;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private wave: Float32Array<ArrayBuffer> | null = null;
  private gen = 0; // 새 답변마다 올려서 이전 답변의 늦게 온 소리를 버린다
  private pending = ""; // 아직 문장이 끝나지 않은 글
  private carry = ""; // 너무 짧아 다음 문장에 붙일 글
  private inParen = 0;
  private lines: Line[] = [];
  private source: AudioBufferSourceNode | null = null;
  private waitingHead = false;
  private level = 0;
  private sfxList: Record<string, string[]> | null = null;
  private readonly sfxBuf = new Map<string, Promise<AudioBuffer | null>>();
  private sfxLastAt = 0;
  private sfxLastFile = "";

  constructor(private readonly actor: AutoActor) {
    let on = true;
    try {
      on = localStorage.getItem(STORE_KEY) !== "0";
    } catch {
      /* 저장소를 못 쓰면 기본값 */
    }
    this.enabledFlag = on;
    actor.voiceMode = on;
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  /**
   * 말 아닌 소리 하나 재생 (kind: laugh·giggle·shyLaugh·sigh·hmm·surprise·huff·sob·cheer·wow·effort).
   * 목소리가 꺼져 있거나 말하는 중이거나 방금 소리를 냈으면 하지 않는다.
   */
  /**
   * 키보드 누르는 소리 (소리 파일 없이 만들어 냄): 짧은 '딸깍'(고음 잡음) + 낮은 '톡'(바닥에 닿는 소리).
   * 몇 번에 한 번은 스페이스바처럼 낮고 길게. 목소리가 켜져 있을 때만.
   */
  keyClick(strength = 1): void {
    if (!this.enabledFlag || !this.ctx || this.ctx.state !== "running") return;
    const ctx = this.ctx;
    if (!this.noise) {
      const n = Math.floor(ctx.sampleRate * 0.08);
      this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    this.keyCount++;
    const space = this.keyCount % 7 === 0 && Math.random() < 0.7;
    const now = ctx.currentTime;
    const vol = KEY_VOLUME * (0.6 + 0.4 * strength) * (0.8 + Math.random() * 0.4);
    // 딸깍
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = space ? 1300 + Math.random() * 300 : 2400 + Math.random() * 1600;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    const len = space ? 0.06 : 0.035;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, now + len);
    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start(now, Math.random() * 0.03, len + 0.01);
    // 톡 (키가 바닥에 닿음)
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = space ? 140 : 210 + Math.random() * 60;
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.5, now + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0005, now + (space ? 0.05 : 0.03));
    o.connect(og);
    og.connect(ctx.destination);
    o.start(now + 0.004);
    o.stop(now + 0.06);
  }
  private noise: AudioBuffer | null = null;
  private keyCount = 0;

  /** 사용자 조작(버튼 누름) 안에서 불러 소리 장치를 깨워 둔다 — 브라우저 자동 재생 제한 */
  unlock(): void {
    if (this.enabledFlag) this.ensureContext();
  }

  playSfx(kind: string): void {
    if (!this.enabledFlag || this.source) return;
    const now = performance.now() / 1000;
    if (now - this.sfxLastAt < SFX_GAP) return;
    this.sfxLastAt = now;
    this.ensureContext();
    void this.playSfxAsync(kind);
  }

  /** 소리 확인 버튼용: 그 종류의 소리를 차례로 하나씩 (간격·말하는 중 상관없이). 재생한 파일 이름을 돌려준다 */
  async previewSfx(kind: string): Promise<string> {
    this.ensureContext();
    await this.loadSfxList();
    const files = this.sfxList?.[kind] ?? [];
    if (!files.length) return "";
    const i = ((this.previewIdx.get(kind) ?? -1) + 1) % files.length;
    this.previewIdx.set(kind, i);
    await this.playFile(files[i]);
    return `${files[i]} (${i + 1}/${files.length})`;
  }
  private readonly previewIdx = new Map<string, number>();

  /** 소리 종류 목록 */
  async sfxKinds(): Promise<string[]> {
    await this.loadSfxList();
    return Object.keys(this.sfxList ?? {});
  }

  private async loadSfxList(): Promise<void> {
    if (this.sfxList) return;
    try {
      this.sfxList = (await (await fetch(SFX_URL + "sfx.json")).json()) as Record<string, string[]>;
    } catch {
      this.sfxList = {};
    }
  }

  private async playFile(file: string): Promise<void> {
    if (!this.ctx) return;
    let p = this.sfxBuf.get(file);
    if (!p) {
      const ctx = this.ctx;
      p = fetch(SFX_URL + file)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
      this.sfxBuf.set(file, p);
    }
    const buf = await p;
    if (!buf || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = SFX_VOLUME;
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
  }

  private async playSfxAsync(kind: string): Promise<void> {
    if (!this.sfxList) {
      try {
        this.sfxList = (await (await fetch(SFX_URL + "sfx.json")).json()) as Record<string, string[]>;
      } catch {
        this.sfxList = {};
      }
    }
    const files = (this.sfxList[kind] ?? []).filter((f) => f !== this.sfxLastFile);
    if (!files.length || !this.ctx) return;
    const file = files[Math.floor(Math.random() * files.length)];
    this.sfxLastFile = file;
    let p = this.sfxBuf.get(file);
    if (!p) {
      const ctx = this.ctx;
      p = fetch(SFX_URL + file)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
      this.sfxBuf.set(file, p);
    }
    const buf = await p;
    if (!buf || !this.ctx || this.source) return; // 그새 말을 시작했으면 안 냄
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = SFX_VOLUME;
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
  }

  setEnabled(on: boolean): void {
    this.enabledFlag = on;
    this.actor.voiceMode = on;
    try {
      localStorage.setItem(STORE_KEY, on ? "1" : "0");
    } catch {
      /* 무시 */
    }
    if (on) this.ensureContext();
    else this.stop();
  }

  onChatEvent(ev: ChatEvent): void {
    if (ev.type === "send" || ev.type === "opening") {
      // 메시지를 보내는 순간(사용자 조작 안)에 소리 장치를 깨워 둔다 — 브라우저 자동 재생 제한
      if (this.enabledFlag) this.ensureContext();
      this.stop();
      return;
    }
    if (!this.enabledFlag) return;
    if (ev.type === "text") {
      this.take(ev.delta ?? "");
      this.cutSentences(false);
    } else if (ev.type === "end") {
      this.cutSentences(true);
    }
  }

  /** 매 프레임: 재생 중인 소리 크기(0~1)를 하루 입 모양에 넘긴다 */
  update(dt: number): void {
    let target = 0;
    if (this.source && this.analyser && this.wave) {
      this.analyser.getFloatTimeDomainData(this.wave);
      let sum = 0;
      for (let i = 0; i < this.wave.length; i++) sum += this.wave[i] * this.wave[i];
      target = Math.min(1, Math.sqrt(sum / this.wave.length) * 7);
    }
    // 올라갈 땐 빠르게, 내려갈 땐 조금 천천히 (입이 덜컥 닫히지 않게)
    const k = 1 - Math.exp(-dt * (target > this.level ? 30 : 14));
    this.level += (target - this.level) * k;
    this.actor.voiceLevel = this.level;
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }

  private ensureContext(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(this.ctx.destination);
      this.wave = new Float32Array(this.analyser.fftSize);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** 하던 말을 멈추고 대기 중인 문장을 버린다 */
  private stop(): void {
    this.gen++;
    this.pending = "";
    this.carry = "";
    this.inParen = 0;
    this.lines = [];
    this.waitingHead = false;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* 이미 끝남 */
      }
      this.source = null;
    }
    this.actor.voiceActive = false;
  }

  /** 답변 조각에서 괄호 지문을 빼고 쌓는다 */
  private take(delta: string): void {
    for (const ch of delta) {
      if (ch === "(" || ch === "（") this.inParen++;
      else if (ch === ")" || ch === "）") this.inParen = Math.max(0, this.inParen - 1);
      else if (this.inParen === 0) this.pending += ch;
    }
  }

  /** 끝난 문장을 잘라 소리를 주문한다. last 면 남은 글도 모두 */
  private cutSentences(last: boolean): void {
    const END = /[.!?…~\n]+["'」』]*/g;
    let m: RegExpExecArray | null;
    let from = 0;
    while ((m = END.exec(this.pending))) {
      const cut = m.index + m[0].length;
      this.push(this.pending.slice(from, cut));
      from = cut;
    }
    this.pending = this.pending.slice(from);
    if (this.pending.length > MAX_CHARS) {
      const i = Math.max(this.pending.lastIndexOf(",", MAX_CHARS), this.pending.lastIndexOf(" ", MAX_CHARS));
      const cut = i > 20 ? i + 1 : MAX_CHARS;
      this.push(this.pending.slice(0, cut));
      this.pending = this.pending.slice(cut);
    }
    if (last) {
      this.push(this.pending, true);
      this.pending = "";
    }
  }

  private push(raw: string, force = false): void {
    const text = cleanForSpeech(this.carry + " " + raw);
    this.carry = "";
    if (!speakable(text)) return;
    if (speakable(text) < MIN_CHARS && !force) {
      this.carry = text;
      return;
    }
    const g = this.gen;
    const audio = this.synth(text).then((buf) => (g === this.gen ? buf : null));
    this.lines.push({ text, audio });
    this.pump();
  }

  private async synth(text: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch("/api/haru/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !this.ctx) return null;
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** 지금 말하는 게 없으면 다음 문장을 (소리가 준비되는 대로) 재생 */
  private pump(): void {
    if (this.source || this.waitingHead || !this.lines.length) return;
    const head = this.lines[0];
    const g = this.gen;
    this.waitingHead = true;
    void head.audio.then((buf) => {
      if (g !== this.gen) return;
      this.lines.shift();
      if (!buf || !this.ctx || !this.analyser) {
        // 음성 서버가 없거나 실패: 소리 없이 입만 (초당 7음절 정도), 그만큼 기다렸다 다음 문장
        const dur = Math.max(0.6, speakable(head.text) / 7);
        this.actor.speakLine(head.text, dur);
        setTimeout(() => {
          if (g !== this.gen) return;
          this.waitingHead = false;
          this.pump();
        }, dur * 1000 + 300);
        return;
      }
      this.waitingHead = false;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.analyser);
      src.onended = () => {
        if (this.source !== src) return;
        this.source = null;
        this.actor.voiceActive = false;
        // 다음 문장 전에 잠깐 쉰다
        this.waitingHead = true;
        const gap = /[?!]["'」』]*\s*$/.test(head.text) ? QUESTION_GAP : SENTENCE_GAP;
        setTimeout(() => {
          if (g !== this.gen) return;
          this.waitingHead = false;
          this.pump();
        }, gap * 1000);
      };
      this.source = src;
      this.actor.voiceActive = true;
      this.actor.speakLine(head.text, buf.duration);
      src.start();
    });
  }
}
