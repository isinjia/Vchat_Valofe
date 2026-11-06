/**
 * 버튜버처럼 살아 있어 보이게 하는 자동 연기:
 *  - 눈 깜빡임(불규칙, 가끔 두 번)
 *  - 시선 이동(작은 도약 + 말할 때·보낼 때 화면 쪽 응시)
 *  - 고개 미세 흔들림, 말하는 동안 음절에 맞춘 작은 끄덕임
 *  - 립싱크: 답변 글자를 말하는 속도로 한 음절씩 읽으며 한글 모음에 맞춰 입 모양(아·에·이·오·우)을 만든다.
 *    받침 ㅁ·ㅂ 은 입을 다물고, 문장부호·띄어쓰기에서는 잠깐 쉰다. 괄호 안 지문 "(…)" 은 읽지 않는다.
 *  - 감정 판정에 따른 표정 프리셋(서서히 평소로 복귀)
 */
import type { ChatEvent } from "@/lib/chat-events";
import type { HandGesture } from "./gesture-catalog";
import { NEUTRAL_FACE, type FaceParams } from "./face-rig";

interface Preset extends Partial<FaceParams> { hold: number }

// 앉아서 방송하는 하루의 감정 표현: 얼굴 + 작은 상체 몸짓(서서 하는 게임 몸짓은 앉은 몸에 얹으면 어색해서 쓰지 않음)
const EMOTION_PRESETS: Record<string, Preset> = {
  // 눈꺼풀을 반쯤 내리면 졸리거나 비웃는 눈이 되어 어색하다(사용자 지적) → 눈은 뜬 채로, 입·고개·상체로 표현
  joy: { smile: 0.45, brow: 0.12, headPitch: 0.03, shoulders: 0.12, hold: 7 },
  love: { smile: 0.45, headRoll: 0.06, bodyRoll: 0.02, shoulders: 0.15, hold: 8 },
  sad: { smile: -0.45, gazeY: -0.25, headPitch: -0.06, bodyPitch: 0.06, shoulders: -0.35, hold: 8 },
  angry: { smile: -0.35, headPitch: -0.02, bodyPitch: 0.05, shoulders: 0.15, hold: 6 },
  shy: { smile: 0.22, brow: 0.15, gazeX: 0.25, gazeY: -0.2, headRoll: 0.06, headYaw: 0.05, bodyRoll: -0.02, shoulders: 0.5, hold: 6 },
  surprised: { blinkL: -0.05, blinkR: -0.05, brow: 0.6, jaw: 0.16, headPitch: 0.04, bodyPitch: -0.05, shoulders: 0.45, hold: 2.5 },
  neutral: { hold: 0 },
};

// ---------------------------------------------------------------- 립싱크
/** 한 음절(또는 쉼)의 입 모양 */
interface Viseme {
  jaw: number;
  width: number;
  pucker: number;
  /** 이 음절에 쓰는 시간 배율 (1 = 한 음절) */
  len: number;
  /** 받침 ㅁ·ㅂ·ㅍ: 끝에 입을 다문다 */
  close?: boolean;
  /** 초성 ㅁ·ㅂ·ㅃ·ㅍ: 입술을 붙였다가 연다 */
  closeStart?: boolean;
  /** 쉼(띄어쓰기·문장부호) */
  pause?: boolean;
  /** 웃음소리(하하·히히·ㅋㅋ 등) — 웃으며 몸을 들썩인다 */
  laugh?: boolean;
  /** 문장 끝 쉼 (살짝 끄덕임) */
  sentenceEnd?: boolean;
  /** 쉼을 만든 문장부호 (? ! . , … ~ 줄바꿈) — 말버릇 연기(눈 크게 뜨기·고개 갸웃·깜빡임)에 씀 */
  mark?: string;
}

/** 쉼 표시 우선순위 (쉼이 겹칠 때 강한 쪽을 남긴다) */
const MARK_RANK: Record<string, number> = { "?": 5, "!": 4, ".": 3, "\n": 3, "。": 3, "…": 2, ",": 1, "~": 1, " ": 0 };

// 중성(모음) 21개: ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ
// 모음별 입 모양: jaw 벌림, width 폭(+넓게/-동그랗게), pucker 오므림. 미소(smile)는 감정 표정에서만 쓴다
const A = { jaw: 0.8, width: 0.15, pucker: 0 };
const E = { jaw: 0.5, width: 0.45, pucker: 0 };
const EO = { jaw: 0.6, width: 0, pucker: 0.1 };
const O = { jaw: 0.62, width: -0.4, pucker: 0.3 };
const U = { jaw: 0.5, width: -0.55, pucker: 0.4 };
const EU = { jaw: 0.3, width: 0.35, pucker: 0 };
const I = { jaw: 0.3, width: 0.6, pucker: 0 };
const JUNG: Array<{ jaw: number; width: number; pucker: number }> = [
  A, E, A, E, EO, E, EO, E, O, A, E, E, O, U, EO, E, I, U, EU, I, I,
];
const SPEECH_RATE = 7; // 초당 음절 (차분한 하루 말투)
/** 말할 때 입 벌림 전체 배율 — 크게 벌리지 않는 편이 자연스럽다(사용자 의견) */
const SPEECH_OPEN = 0.65;

/** 입 모양 사이를 잇는 용수철 세기(클수록 빠름). 26 이면 한 모양에서 다음 모양까지 약 0.12초 */
const MOUTH_SPRING = 26;

/** 매끄러운 입 값 → 다문 입 / 작은 입 / 중간 입 / 연 입 / 동그란 입 중 하나 (값은 SPEECH_OPEN 반영 뒤 기준) */
function quantizeMouth(m: { jaw: number; width: number; pucker: number }): { jaw: number; width: number; pucker: number } {
  if (m.jaw < 0.06) return { jaw: 0, width: 0, pucker: 0 };
  if (m.pucker > 0.18) return { jaw: m.jaw < 0.22 ? 0.22 : 0.34, width: -0.45, pucker: 0.32 };
  const wide = m.width > 0.3;
  if (m.jaw < 0.2) return { jaw: 0.17, width: wide ? 0.5 : 0.25, pucker: 0 };
  if (m.jaw < 0.36) return { jaw: 0.31, width: wide ? 0.42 : 0.15, pucker: 0 };
  return { jaw: 0.47, width: 0.15, pucker: 0 };
}

function smooth(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

function visemeOf(ch: string): Viseme | null {
  const c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) {
    const code = c - 0xac00;
    const jung = Math.floor((code % 588) / 28);
    const jong = code % 28;
    const cho = Math.floor(code / 588);
    const v = JUNG[jung] ?? A;
    // 받침 ㅁ(16) ㅂ(17) ㅄ(18) ㅍ(26) 은 끝에 입술을 닫고, 초성 ㅁ(6) ㅂ(7) ㅃ(8) ㅍ(17) 은 닫았다 연다
    return {
      ...v,
      len: 1,
      close: jong === 16 || jong === 17 || jong === 18 || jong === 26,
      closeStart: cho === 6 || cho === 7 || cho === 8 || cho === 17,
    };
  }
  if (/[a-zA-Z0-9]/.test(ch)) return { jaw: 0.4, width: 0.15, pucker: 0, len: 0.7 };
  if (ch === " ") return { jaw: 0, width: 0, pucker: 0, len: 0.5, pause: true, mark: " " };
  if (ch === "\n") return { jaw: 0, width: 0, pucker: 0, len: 2.2, pause: true, sentenceEnd: true, mark: "\n" };
  if (/[.!?。]/.test(ch)) return { jaw: 0, width: 0, pucker: 0, len: 2.6, pause: true, sentenceEnd: true, mark: ch };
  if (/[,…~]/.test(ch)) return { jaw: 0, width: 0, pucker: 0, len: 1.6, pause: true, mark: ch };
  return null; // 따옴표 등은 건너뜀
}

// ---------------------------------------------------------------- 답변 첫머리로 감정 바로 판단
// 서버의 감정 판정은 답변이 다 끝난 뒤 10~15초 늦게 오므로, 표정은 답변 첫머리(지문 + 첫 문장)로 바로 정한다.
// 앞에 있을수록 우선(놀람 > 화남 > 슬픔 > 부끄러움 > 애정 > 기쁨), 점수가 같으면 이 순서.
const EMOTION_CUES: Array<[string, RegExp]> = [
  ["surprised", /히익|헉|에엣|어머|깜짝|놀라|놀란|세상에|설마|정말요\?|진짜요\?|네\?!|에\?/g],
  ["angry", /화가|화난|용서|비켜|짜증|분노|이를 악|노려|주먹을 (꽉 )?쥐|단호|서늘/g],
  ["sad", /미안|죄송|슬프|슬퍼|슬픈|눈물|울먹|속상|그리워|그립|외로|힘들|안타깝|씁쓸|한숨|고개를 (숙|떨)|어깨가 처|가슴이 아/g],
  // 한글 활용형(붉어진다·붉어지며…) 때문에 단서는 어간으로 적는다
  ["shy", /부끄|쑥스|수줍|머쓱|민망|붉어|빨개|발그|귀까지|헤헤|저 같은 게|시선을 피|꼼지락/g],
  ["love", /좋아해|사랑|소중|다정|두근|설레|따뜻하게 (웃|바라)|포근/g],
  ["joy", /아하하|하하|후후|웃으|웃는|웃음|미소|기뻐|기쁘|기쁜|다행|신나|반가|축하|활짝|밝게|눈이 반짝|좋아요|좋네요|재밌|즐거/g],
];

export function inferEmotion(text: string): string {
  // 지문 "(…)" 은 하루의 실제 표정 묘사라 두 배로 친다 (예: "얼굴이 붉어진다" > 말버릇 "히익")
  const stage = (text.match(/\([^)]*\)?/g) ?? []).join(" ");
  const spoken = text.replace(/\([^)]*\)?/g, " ");
  let best = "neutral";
  let bestScore = 0;
  for (const [name, re] of EMOTION_CUES) {
    const n = (stage.match(re) ?? []).length * 2 + (spoken.match(re) ?? []).length;
    if (n > bestScore) {
      best = name;
      bestScore = n;
    }
  }
  return best;
}

/** 감정 → 게임 원본 표정 후보 (game-face.ts 의 이름). 같은 이름이 여러 번이면 더 자주 뽑힌다 */
const GAME_FACE_FOR: Record<string, string[]> = {
  joy: ["joyEyes", "smile", "smile", "wink"],
  love: ["soft", "joyEyes"],
  sad: ["sad"],
  shy: ["shy", "soft"],
  surprised: ["surprised"],
};
/** 문장 끝에서 다시 표정을 지을 수 있는 감정 (긴 슬픔·순간 놀람은 한 번만) */
const GAME_FACE_REPEAT = new Set(["joy", "love", "shy"]);

export type IdleName = "lookAround" | "yawn" | "bored" | "stretch" | "hum" | "settle" | "drink";
interface IdleOut {
  look?: { x: number; y: number };
  headFollow?: number;
  jaw?: number;
  blink?: number;
  headPitch?: number;
  headRoll?: number;
  headYaw?: number;
  shoulders?: number;
  bodyPitch?: number;
  bodyRoll?: number;
  bodyYaw?: number;
  smile?: number;
}
/** 조용할 때 행동 길이(초) */
const IDLE_LEN: Record<IdleName, number> = { lookAround: 4.6, yawn: 2.8, bored: 3.6, stretch: 4.2, hum: 6, settle: 2.2, drink: 5.4 };

function shuffle<X>(a: X[]): X[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- 몸짓
/**
 * 몸짓: 정해진 길이 동안 상체·어깨·고개에 더하는 움직임. 감정이 정해질 때 큰 몸짓 하나,
 * 말하는 도중 느낌표·물음표·웃음소리에서 작은 몸짓이 나온다. 두 손은 키보드에 붙어 있으므로(팔 계산) 몸만 움직인다.
 */
export type GestureName = "laugh" | "giggle" | "sway" | "flinch" | "shrink" | "sigh" | "huff" | "lean" | "tilt";
interface BodyOut {
  bodyPitch: number;
  bodyRoll: number;
  bodyYaw: number;
  shoulders: number;
  headPitch: number;
  headRoll: number;
  headYaw: number;
}
interface Gesture {
  name: GestureName;
  start: number;
  len: number;
  amp: number;
  dir: number;
}
/** 몸짓을 원래 짠 것보다 느긋하게 (길이는 늘리고 들썩임은 느리게) */
const BODY_SLOW = 1.6;
/** 몸짓 길이(초) — 실제로는 BODY_SLOW 배 */
const GESTURE_LEN: Record<GestureName, number> = {
  laugh: 1.6, giggle: 0.9, sway: 3.2, flinch: 1.0, shrink: 2.8, sigh: 2.6, huff: 1.3, lean: 0.7, tilt: 1.0,
};
/** 감정이 정해질 때 나오는 큰 몸짓 */
const GESTURE_FOR: Record<string, GestureName> = {
  joy: "laugh", love: "sway", surprised: "flinch", shy: "shrink", sad: "sigh", angry: "huff",
};
/** 0~1 구간에서 a 까지 올라갔다가 r 부터 내려오는 모양 */
function envelope(ph: number, a: number, r: number): number {
  if (ph <= 0 || ph >= 1) return 0;
  if (ph < a) return smooth(ph / a);
  if (ph > r) return 1 - smooth((ph - r) / (1 - r));
  return 1;
}
/** 몸짓 하나의 지금 움직임을 out 에 더한다 */
function gestureBody(g: Gesture, t: number, out: BodyOut): void {
  const ph = (t - g.start) / g.len;
  const e = (t - g.start) / BODY_SLOW; // 들썩임·흔들림 박자
  const A = g.amp;
  switch (g.name) {
    case "laugh": {
      // 소리 내 웃음: 살짝 뒤로 젖히며 어깨가 통통 들썩이고 점점 잦아듦
      const env = envelope(ph, 0.08, 0.45);
      const bounce = Math.abs(Math.sin(e * 12));
      out.shoulders += bounce * 0.7 * env * A;
      out.bodyPitch += (-0.07 + bounce * 0.035) * env * A;
      out.headPitch += 0.07 * env * A;
      out.bodyRoll += Math.sin(e * 3) * 0.025 * env * A * g.dir;
      break;
    }
    case "giggle": {
      // 말하다 웃음소리: 어깨만 작게 들썩
      const env = envelope(ph, 0.1, 0.5);
      out.shoulders += Math.abs(Math.sin(e * 13)) * 0.4 * env * A;
      out.bodyPitch += Math.abs(Math.sin(e * 13)) * 0.02 * env * A;
      break;
    }
    case "sway": {
      // 애정: 화면 쪽으로 살짝 다가오며 좌우로 살랑, 고개 갸웃
      const env = envelope(ph, 0.15, 0.7);
      out.bodyRoll += Math.sin(e * 2.4) * 0.07 * env * A * g.dir;
      out.bodyYaw += Math.sin(e * 2.4 + 0.6) * 0.04 * env * A * g.dir;
      out.bodyPitch += 0.05 * env * A;
      out.headRoll += (0.07 * g.dir + Math.sin(e * 2.4 + 0.5) * 0.04) * env * A;
      break;
    }
    case "flinch": {
      // 놀람: 순간 뒤로 움찔, 어깨가 확 올라갔다 천천히 내려옴
      const env = envelope(ph, 0.1, 0.35);
      out.bodyPitch -= 0.15 * env * A;
      out.shoulders += 0.8 * envelope(ph, 0.06, 0.25) * A;
      out.headPitch += 0.08 * env * A;
      out.bodyYaw += 0.03 * env * A * g.dir;
      break;
    }
    case "shrink": {
      // 부끄러움: 어깨를 움츠리고 몸을 살짝 돌려 고개를 숙이며 꼼지락
      const env = envelope(ph, 0.15, 0.7);
      out.shoulders += 0.5 * env * A;
      out.bodyPitch += 0.06 * env * A;
      out.bodyYaw += 0.13 * env * A * g.dir;
      out.headPitch -= 0.07 * env * A;
      out.headRoll += 0.05 * env * A * g.dir;
      out.bodyRoll += Math.sin(e * 5) * 0.015 * env * A;
      break;
    }
    case "sigh": {
      // 슬픔: 숨을 크게 들이쉬어 어깨가 올라갔다가, 내쉬며 축 처지고 앞으로 수그림
      const inh = envelope(ph, 0.25, 0.3);
      const slump = envelope(ph, 0.45, 0.8) * smooth((ph - 0.25) / 0.2);
      out.shoulders += 0.45 * inh * A - 0.45 * slump * A;
      out.bodyPitch += -0.03 * inh * A + 0.09 * slump * A;
      out.headPitch += 0.03 * inh * A - 0.09 * slump * A;
      break;
    }
    case "huff": {
      // 화남: 앞으로 홱 다가오며 어깨에 힘, 고개를 작게 도리질
      const env = envelope(ph, 0.1, 0.55);
      out.bodyPitch += 0.09 * env * A;
      out.shoulders += 0.4 * env * A;
      out.headYaw += Math.sin(e * 14) * 0.05 * envelope(ph, 0.1, 0.4) * A;
      break;
    }
    case "lean": {
      // 느낌표: 말에 힘을 주며 앞으로 살짝 끄덕
      const env = envelope(ph, 0.25, 0.4);
      out.bodyPitch += 0.045 * env * A;
      out.shoulders += 0.15 * env * A;
      break;
    }
    case "tilt": {
      // 물음표: 몸과 고개를 한쪽으로 갸웃
      const env = envelope(ph, 0.25, 0.6);
      out.bodyRoll += 0.04 * env * A * g.dir;
      out.bodyYaw += 0.03 * env * A * g.dir;
      break;
    }
  }
}

/** 감정이 정해질 때 내는 말 아닌 소리와 그 확률 */
const SOUND_FOR: Record<string, [string, number]> = {
  joy: ["giggle", 0.35], love: ["shyLaugh", 0.3], shy: ["shyLaugh", 0.5], surprised: ["surprise", 0.85], sad: ["sigh", 0.6], angry: ["huff", 0.7],
};
/** 상체 몸짓에 어울리는 소리 (동작 확인 버튼용) */
const SOUND_FOR_BODY: Partial<Record<GestureName, string>> = {
  laugh: "laugh", giggle: "giggle", flinch: "surprise", shrink: "shyLaugh", sigh: "sigh", huff: "huff",
};

/** 감정마다 어울리는 손 제스처 (gesture-catalog 의 이름) */
const HAND_FOR: Record<string, HandGesture[]> = {
  joy: ["clapLaugh", "giggle", "raise", "peace", "thumbsUp"],
  love: ["heart", "please"],
  shy: ["shy", "scratch", "coverEyes"],
  surprised: ["coverMouth"],
  sad: ["tear"],
};
/** 말하는 도중 가끔 쓰는 손짓 */
const HAND_TALK: HandGesture[] = ["explain", "think", "explain"];
/** 제스처 사이 최소 간격(초) */
const HAND_GAP = 7;

export class AutoActor {
  /** 손 제스처 재생 요청 (HaruStream 이 몸 애니메이션으로 연결). 다른 동작 중이라 못 하면 false */
  onGesture?: (key: HandGesture) => boolean;
  /** 하던 손 제스처를 멈추고 손을 키보드로 (채팅 치기 시작할 때) */
  onGestureStop?: () => void;
  /** 게임 원본 표정을 재생해 달라는 요청 (HaruStream 이 GameFace 로 연결) */
  onExpression?: (name: string) => void;
  /** 말 아닌 소리(웃음·한숨 등) 요청 (HaruStream 이 HaruVoice.playSfx 로 연결) */
  onSound?: (kind: string) => void;
  /** 게임 원본 표정 층의 지금 세기 — 겹치지 않게 절차 표정(깜빡임·눈 뜨기·미소)을 그만큼 줄인다 */
  faceOverlay = 0;
  faceOverlayMouth = 0;
  /** 채팅 치는 자세 세기 (0~1) — HaruStream 의 TypingPose 가 팔을 책상에 올리는 데 쓴다 */
  typingWeight = 0;
  private typeLook = { x: 0.28, y: -0.2 };
  private typeLookUntil = 0;
  private t = 0;
  private nextBlink = 2;
  private blinkPhase = -1; // -1 쉼, 0~1 진행
  private blinkDouble = false;
  private gaze = { x: 0, y: 0 };
  private gazeTarget = { x: 0, y: 0 };
  private nextGaze = 1.5;
  private lookAtViewerUntil = 0;
  private preset: Preset | null = null;
  private presetUntil = 0;
  /** 지금 표정이 이번 답변의 것인지 (말하는 동안 유지할지) */
  private presetForReply = false;
  private presetWeight = 0;
  private nodUntil = 0;
  private emotionName = "";
  private emotionAt = -99;
  // 이번 답변의 감정 판단 상태
  private replyText = ""; // 첫머리 글 (지문 포함)
  private replySpoken = 0; // 지문 밖 글자 수
  private replyDecided = true; // 아직 답변이 없으면 판단할 게 없음
  private firstTextAt = -1;
  private speakAfter = 0; // 표정이 먼저 자리 잡도록 말 시작을 잠깐 늦춤
  private cur: FaceParams = { ...NEUTRAL_FACE };

  // 립싱크 상태
  private queue: Viseme[] = [];
  private inParen = 0;
  private sylT = 0; // 현재 음절 경과(음절 단위)
  private sylNow: Viseme | null = null;
  private mouth = { jaw: 0, width: 0, pucker: 0 };
  private talkBob = 0;
  private prevShape = { jaw: 0, width: 0, pucker: 0 }; // 앞 음절 끝 입 모양 (다음 음절로 부드럽게 이어 감)
  private sylScale = 1; // 음절마다 한 번 정하는 크기 변화
  // 애니메이션식 입: 매끄러운 입 값을 몇 가지 입 모양으로 바꿔 1초에 12번만 갱신
  // 입 모양 사이를 용수철처럼 잇는 상태 (값 + 속도)
  private mouthVel = { jaw: 0, width: 0, pucker: 0 };
  private mouthOut = { jaw: 0, width: 0, pucker: 0 };
  // 말버릇 연기
  private browKick = 0; // 눈을 크게 뜨는 순간 (물음·느낌표·문장 시작)
  private tiltKick = 0; // 물음표에서 고개 갸웃
  private tiltDir = 1;
  private headOff = { yaw: 0, roll: 0 }; // 문장마다 살짝 바뀌는 고개 방향
  private headOffTarget = { yaw: 0, roll: 0 };
  private lastBlinkEnd = -9;
  private afterSentence = true; // 다음 음절이 문장 첫 음절인지
  // 감정 입꼬리 문: 말하는 동안 기본은 평소 입꼬리(0), 일부 낱말과 멈춤에서만 감정 입꼬리(1)
  private emoGate = 1;
  private emoGateTarget = 1;
  private wordStart = true;
  // 말 속도 맞추기: 답변 글이 다 들어왔는지
  private streamEnded = true;
  // 시선 연기: 메시지 읽기 → 답 기다리며 생각 → 말하는 중 가끔 시선 피하기
  private readUntil = 0; // 메시지를 받은 직후 잠깐 아래(읽는 곳)를 봄
  private waitingReply = false; // 답이 오기 전 (생각 중)
  private thinkLooking = false;
  private thinkPhaseUntil = 0;
  private thinkSide = 1;
  private glance = { x: 0, y: 0 };
  private glanceUntil = 0;
  private nextGlance = 0;
  // 조용할 때 행동 (대화가 한동안 없으면 두리번·하품·심심해하기)
  private lastActivity = 0;
  private idleNext = 25 + Math.random() * 15;
  private idleAct: { name: IdleName; start: number } | null = null;
  private idleOrder: IdleName[] = [];
  // 숨쉬기
  private breathPhase = Math.random() * Math.PI * 2;
  private thinkRollCur = 0;
  // 눈 연기: 아주 작은 눈동자 떨림(미세 단속운동), 큰 시선 이동 때 깜빡임, 눈이 먼저·고개는 늦게
  private sacc = { x: 0, y: 0 };
  private nextSacc = 0;
  private lastGazeTarget = { x: 0, y: 0 };
  private headGaze = { x: 0, y: 0 };
  private settleSide = 1;
  // 목소리 강세: 소리가 평소보다 확 커지는 순간 고개를 살짝 끄덕이고 눈을 크게 뜬다
  private levelSlow = 0;
  private levelPrev = 0;
  private accentNext = 0;
  private accentKick = 0;
  private spokeSinceEmotion = false; // 이번 표정으로 말을 시작했는지 (말한 뒤에는 표정의 입 벌림을 쓰지 않음)
  // 아주 가끔 고개를 좌우로 천천히 흔들기 (말하지 않을 때만)
  private gestures: Gesture[] = [];
  /** 목소리 모드: 입 모양을 답변 글이 아니라 재생하는 목소리(HaruVoice)에 맞춘다 */
  voiceMode = false;
  /** 목소리 재생 중인지, 지금 소리 크기(0~1) — HaruVoice 가 매 프레임 넣는다 */
  voiceActive = false;
  voiceLevel = 0;
  private voiceRate = 0; // 0 이 아니면 지금 문장을 소리에 맞춰 말하는 중
  private voiceEndWall = 0; // 지금 문장 소리가 끝나는 실제 시각(초, performance.now 기준)
  private handNext = 0; // 다음 손 제스처를 할 수 있는 시각
  private sentencesSinceHand = 0;
  private bodyOff = { yaw: 0, pitch: 0 }; // 문장마다 살짝 바뀌는 몸 자세
  private bodyOffTarget = { yaw: 0, pitch: 0 };
  private lastLaughAt = -99;
  private feedPrev = "";
  private nextSway = 30 + Math.random() * 30;
  private swayStart = -1;
  private readonly SWAY_LEN = 2.6;

  /** 지금 말하는 중인지 (밀린 글자가 남아 있으면 true) */
  get talking(): boolean {
    return this.sylNow !== null || this.queue.length > 0;
  }

  onChatEvent(ev: ChatEvent): void {
    // 대화가 오가면 조용할 때 행동은 멈추고 다시 기다린다
    this.lastActivity = this.t;
    this.idleAct = null;
    this.idleNext = this.t + 25 + Math.random() * 15;
    if (ev.type === "send" || ev.type === "opening") {
      if (ev.type === "send") {
        // 메시지를 읽으며 살짝 끄덕이고(아래를 봄), 그다음 답을 생각한다(위쪽 옆을 봄)
        this.readUntil = this.t + 0.9;
        this.nodUntil = this.t + 0.7;
        // 읽고 나서 답을 떠올리는 동안 위쪽 옆을 본다
        this.thinkPhaseUntil = this.readUntil + 0.9 + Math.random() * 0.8;
        this.thinkSide = Math.random() < 0.5 ? -1 : 1;
      } else {
        this.thinkPhaseUntil = this.t + 0.3;
      }
      this.lookAtViewerUntil = 0;
      this.waitingReply = true;
      this.onGestureStop?.(); // 채팅을 치러 손을 키보드로
      this.pendingEmotionMove = null;
      this.thinkLooking = false;
      // 새 답변 준비: 읽다 만 문장 정리, 감정 판단 초기화
      this.queue.length = 0;
      this.inParen = 0;
      this.replyText = "";
      this.replySpoken = 0;
      this.replyDecided = false;
      // 앞 답변의 표정은 서서히 풀고, 이번 답변 표정이 정해지기 전까지 유지하지 않는다
      this.presetUntil = Math.min(this.presetUntil, this.t);
      this.presetForReply = false;
      this.firstTextAt = -1;
      this.streamEnded = false;
      this.voiceRate = 0;
    } else if (ev.type === "text") {
      const d = ev.delta ?? "";
      if (this.firstTextAt < 0) {
        this.firstTextAt = this.t;
        // 답이 나오기 시작: 생각을 마치고 화면(보는 사람)을 보며 말한다
        this.waitingReply = false;
        this.lookAtViewerUntil = this.t + 2.5;
        this.nextGlance = this.t + 4 + Math.random() * 6;
      }
      if (!this.replyDecided) {
        this.replyText += d;
        if (this.shouldDecide()) this.decide();
      }
      if (!this.voiceMode) this.feed(d); // 목소리 모드에서는 문장 소리가 나올 때 speakLine 으로 넣는다
    } else if (ev.type === "end") {
      if (!this.replyDecided) this.decide();
      this.streamEnded = true;
      this.waitingReply = false;
    } else if (ev.type === "emotion") {
      // 서버 판정은 답변이 끝난 뒤 늦게 온다. 이미 첫머리로 표정을 정했으면 바꾸지 않는다(말 끝나고 갑자기 바뀌지 않게)
      if (this.replyDecided && this.replyText) return;
      this.setEmotion(ev.emotion);
    }
  }

  /** 첫머리를 충분히 받았는지: 지문이 닫히고 몇 글자 더 왔거나, 지문 없이 한 문장(또는 24자) 정도 */
  private shouldDecide(): boolean {
    const txt = this.replyText;
    const spoken = txt.replace(/\([^)]*\)?/g, "").trim();
    const openParen = (txt.match(/\(/g) ?? []).length > (txt.match(/\)/g) ?? []).length;
    if (openParen) return false;
    if (/[.!?…\n]/.test(spoken) && spoken.length >= 12) return true;
    return spoken.length >= 30;
  }

  private decide(): void {
    this.replyDecided = true;
    const emo = inferEmotion(this.replyText.slice(0, 200));
    this.setEmotion(emo);
    this.speakAfter = this.t + 0.25; // 표정이 먼저 바뀌고 말을 시작
  }

  private setEmotion(emotion: string): void {
    const p = EMOTION_PRESETS[emotion];
    if (!p || p.hold <= 0) return;
    this.emotionName = emotion;
    this.emotionAt = this.t;
    this.spokeSinceEmotion = false;
    this.preset = p;
    this.presetUntil = this.t + p.hold;
    this.presetForReply = true;
    this.lookAtViewerUntil = this.t + 3;
    this.playGameFace(emotion);
    const snd = SOUND_FOR[emotion];
    if (snd && Math.random() < snd[1]) this.onSound?.(snd[0]);
    // 몸짓·손짓은 실제로 말을 시작할 때 (목소리가 만들어지는 동안 말없이 몸짓만 먼저 나오면 어색함)
    this.pendingEmotionMove = emotion;
  }
  private pendingEmotionMove: string | null = null;

  /** 감정에 맞는 몸짓·손짓 — 답변의 첫 음절에서 */
  private emotionMove(emotion: string): void {
    const g = GESTURE_FOR[emotion];
    if (g) this.startGesture(g);
    // 손 제스처: 인사말이면 손 흔들기, 아니면 감정에 맞는 손짓 (늘 하지는 않음)
    if (/안녕|반가워|반갑|어서 ?와|잘 ?가|또 ?봐|바이바이/.test(this.replyText.slice(0, 60))) this.tryHand(["wave"], 0.85);
    else this.tryHand(HAND_FOR[emotion] ?? [], 0.6);
  }

  /** 손 제스처 하나를 고르고 (확률 chance) 재생을 요청한다. 채팅 치는 중이거나 간격이 덜 찼으면 안 함 */
  private tryHand(cands: HandGesture[], chance: number): boolean {
    if (!cands.length || !this.onGesture || this.waitingReply || this.t < this.handNext) return false;
    if (Math.random() >= chance) return false;
    const key = cands[Math.floor(Math.random() * cands.length)];
    if (!this.onGesture(key)) return false;
    this.handNext = this.t + HAND_GAP + Math.random() * 5;
    this.sentencesSinceHand = 0;
    return true;
  }

  /** 몸짓 시작. 같은 몸짓이 이미 진행 중이면 새로 시작하지 않는다 */
  /** 표정 확인 버튼용: 감정 표정(얼굴·작은 상체 자세 + 어울리는 게임 표정)만 해 본다. 손짓·몸짓은 하지 않음 */
  previewEmotion(emotion: string): void {
    const p = EMOTION_PRESETS[emotion];
    if (!p) return;
    if (p.hold <= 0) {
      this.presetUntil = this.t; // 무표정: 지금 표정을 서서히 풂
      return;
    }
    this.emotionName = emotion;
    this.emotionAt = this.t;
    this.preset = p;
    this.presetUntil = this.t + Math.max(p.hold, 4);
    this.presetForReply = false;
    this.playGameFace(emotion);
    const snd = SOUND_FOR[emotion];
    if (snd) this.onSound?.(snd[0]);
  }

  /** 조용할 때 행동에 어울리는 소리 */
  private idleSound(name: IdleName): void {
    const r = Math.random();
    if (name === "bored") this.onSound?.("sigh");
    else if (name === "hum") this.onSound?.("hum");
    else if (name === "stretch") this.onSound?.("effort");
    else if (name === "settle" && r < 0.5) this.onSound?.("effort");
    else if (name === "lookAround" && r < 0.4) this.onSound?.("hmm");
    else if (name === "drink") this.drinkSighAt = this.t + 4; // 다 마시고 내려놓을 때 "하아"
  }
  private drinkSighAt = -1;

  /** 동작 확인 버튼용: 조용할 때 행동 하나를 바로 해 본다 */
  previewIdle(name: IdleName): void {
    this.idleAct = { name, start: this.t };
    this.settleSide = Math.random() < 0.5 ? -1 : 1;
    if (name === "yawn") this.onExpression?.("yawn");
    if (name === "drink") this.onGesture?.("sip");
    this.idleSound(name);
  }

  /** 동작 확인 버튼용: 상체 몸짓 하나를 바로 해 본다 */
  previewBodyGesture(name: GestureName): void {
    this.startGesture(name);
    const snd = SOUND_FOR_BODY[name];
    if (snd) this.onSound?.(snd);
  }

  private startGesture(name: GestureName, amp = 1): void {
    const t = this.t;
    if (this.gestures.some((g) => g.name === name && t - g.start < g.len * 0.7)) return;
    this.gestures.push({
      name,
      start: t,
      len: GESTURE_LEN[name] * BODY_SLOW * (0.9 + Math.random() * 0.2),
      amp: amp * (0.85 + Math.random() * 0.3),
      dir: Math.random() < 0.5 ? -1 : 1,
    });
  }

  private playGameFace(emotion: string): void {
    const c = GAME_FACE_FOR[emotion];
    if (c?.length) this.onExpression?.(c[Math.floor(Math.random() * c.length)]);
  }

  /** 답변 조각을 음절 대기열에 넣는다 (괄호 지문 제외) */
  private feed(text: string): void {
    for (const ch of text) {
      if (ch === "(" || ch === "（") { this.inParen++; continue; }
      if (ch === ")" || ch === "）") { this.inParen = Math.max(0, this.inParen - 1); continue; }
      if (this.inParen > 0) continue;
      // 웃음소리: 같은 웃음 글자가 두 번 이어지면(하하·히히·후후·헤헤·ㅋㅋ·ㅎㅎ) 그 자리에서 웃는 몸짓
      const laughCh = /[하히후헤호ㅋㅎ]/.test(ch) && ch === this.feedPrev;
      this.feedPrev = ch;
      if (laughCh && (ch === "ㅋ" || ch === "ㅎ")) {
        const lastQ = this.queue[this.queue.length - 1];
        if (lastQ) lastQ.laugh = true;
        else this.queue.push({ jaw: 0, width: 0, pucker: 0, len: 0.3, pause: true, mark: " ", laugh: true });
        continue;
      }
      const v = visemeOf(ch);
      if (v && laughCh) v.laugh = true;
      if (!v) continue;
      // 쉼이 연달아 오면 하나로 합친다
      const last = this.queue[this.queue.length - 1];
      if (v.pause && last && last.pause) {
        last.len = Math.max(last.len, v.len);
        last.sentenceEnd = last.sentenceEnd || v.sentenceEnd;
        last.laugh = last.laugh || v.laugh;
        if ((MARK_RANK[v.mark ?? " "] ?? 0) > (MARK_RANK[last.mark ?? " "] ?? 0)) last.mark = v.mark;
        continue;
      }
      // 말 시작 전 쉼은 버린다
      if (v.jaw === 0 && this.queue.length === 0 && !this.sylNow) continue;
      this.queue.push(v);
    }
  }

  /**
   * 말 속도: 채팅 글자는 받는 즉시 뜨므로 하루가 일정 속도로 말하면 크게 밀린다.
   *  - 글이 들어오는 동안: 밀린 양에 따라 초당 7 → 12 음절
   *  - 글이 다 들어온 뒤: 남은 말을 약 1.5초 안에 끝내도록, 최대 초당 13 음절
   *  - 그래도 2.5초 넘게 남으면 쉼을 줄이고 음절을 솎아 따라잡는다 (그 속도에선 음절이 눈에 구분되지 않음)
   */
  /**
   * 목소리 모드: 문장 하나의 소리가 재생을 시작할 때 부른다. 그 문장의 입 모양을 소리 길이(duration 초)에 맞춰 돌린다.
   * 앞 문장 입 모양이 남았으면 버린다 (소리는 이미 끝났으므로).
   */
  speakLine(text: string, duration: number): void {
    this.queue.length = 0;
    this.inParen = 0;
    this.feed(text);
    // 문장 끝 쉼은 빼고, 나머지 음절이 소리 길이 동안 고르게 나오도록
    let units = 0;
    let tail = this.queue.length;
    while (tail > 0 && this.queue[tail - 1].pause) tail--;
    for (let i = 0; i < tail; i++) units += this.queue[i].len;
    this.voiceRate = units > 0 ? Math.min(20, Math.max(3, units / Math.max(0.3, duration - 0.15))) : SPEECH_RATE;
    this.voiceEndWall = performance.now() / 1000 + duration - 0.1;
  }

  /** 목소리 모드 말 빠르기: 남은 음절을 남은 소리 시간(실제 시계) 안에 끝내도록 매 프레임 다시 잰다 — 화면이 느려 프레임이 밀려도 소리와 맞춘다 */
  private voiceSpeechRate(): number {
    let tail = this.queue.length;
    while (tail > 0 && this.queue[tail - 1].pause) tail--;
    let units = 0;
    for (let i = 0; i < tail; i++) units += this.queue[i].len;
    if (this.sylNow && !this.sylNow.pause) units += this.sylNow.len * Math.max(0, 1 - this.sylT);
    if (units <= 0) return SPEECH_RATE;
    const left = this.voiceEndWall - performance.now() / 1000;
    return left > 0.05 ? Math.min(30, Math.max(3, units / left)) : 30;
  }

  private speechRate(): number {
    if (this.voiceMode && this.voiceRate > 0) return this.voiceSpeechRate();
    let units = this.queue.reduce((a, v) => a + v.len, 0);
    if (this.sylNow) units += this.sylNow.len * Math.max(0, 1 - this.sylT);
    if (!this.streamEnded) return Math.min(12, Math.max(SPEECH_RATE, SPEECH_RATE + units * 0.2));
    const MAX = 13;
    if (units / MAX > 2.5) {
      this.catchUp(MAX * 2);
      units = this.queue.reduce((a, v) => a + v.len, 0);
    }
    return Math.min(MAX, Math.max(SPEECH_RATE, units / 1.5));
  }

  /** 남은 말을 budget(음절 단위) 안으로 줄인다: 쉼을 짧게, 그래도 넘치면 낱말 안 음절을 하나 걸러 뺀다 */
  private catchUp(budget: number): void {
    for (const v of this.queue) if (v.pause) v.len = Math.min(v.len, v.sentenceEnd ? 1.2 : 0.4);
    let sum = this.queue.reduce((a, v) => a + v.len, 0);
    let flip = false;
    while (sum > budget) {
      const before = this.queue.length;
      this.queue = this.queue.filter((v) => {
        if (v.pause) return true;
        flip = !flip;
        return flip; // 음절 하나 걸러 남김
      });
      sum = this.queue.reduce((a, v) => a + v.len, 0);
      if (this.queue.length === before) break;
    }
  }

  private updateMouth(dt: number): { jaw: number; width: number; pucker: number } {
    // 대화창 글자보다 너무 뒤처지면 조금 빨리 말한다
    const rate = this.speechRate();
    const waiting = !this.voiceMode &&
      (!this.replyDecided && this.firstTextAt >= 0 && this.t - this.firstTextAt < 1.2) || this.t < this.speakAfter;
    if (!this.sylNow && this.queue.length && !waiting) {
      const next = this.queue.shift()!;
      this.sylNow = next;
      this.sylT = 0;
      this.sylScale = 0.88 + Math.random() * 0.2;
      this.onSyllableStart(next);
    }
    let want = { jaw: 0, width: 0, pucker: 0 };
    if (this.sylNow) {
      let v = this.sylNow;
      this.sylT += (dt * rate) / v.len;
      // 목소리 모드: 화면이 느려 한 프레임에 음절이 여럿 지나가면 건너뛰며 소리를 따라간다
      for (let n = 0; this.voiceMode && this.voiceRate > 0 && this.sylT >= 1 && this.queue.length && n < 8; n++) {
        const over = (this.sylT - 1) * v.len;
        this.prevShape = v.pause
          ? { jaw: 0, width: 0, pucker: 0 }
          : { jaw: v.close ? 0 : v.jaw * SPEECH_OPEN * this.sylScale, width: v.width, pucker: v.pucker };
        v = this.queue.shift()!;
        this.sylNow = v;
        this.sylScale = 0.88 + Math.random() * 0.2;
        this.onSyllableStart(v);
        this.sylT = over / v.len;
      }
      const ph = Math.min(1, this.sylT);
      if (v.pause) {
        // 쉼: 입을 편하게 다문다
        want = { jaw: 0, width: this.prevShape.width * 0.3, pucker: 0 };
      } else {
        // 앞 음절 모양에서 이번 모음 모양으로 부드럽게 넘어간다 (낱말 안에서는 입을 닫지 않음)
        const blend = smooth(ph / 0.45);
        const sh = {
          jaw: this.prevShape.jaw + (v.jaw * SPEECH_OPEN * this.sylScale - this.prevShape.jaw) * blend,
          width: this.prevShape.width + (v.width - this.prevShape.width) * blend,
          pucker: this.prevShape.pucker + (v.pucker - this.prevShape.pucker) * blend,
        };
        let open = 1;
        if (v.closeStart) open *= smooth(ph / 0.3); // ㅁ·ㅂ·ㅍ 로 시작: 입술 붙였다가 엶
        if (v.close && ph > 0.7) open *= 1 - smooth((ph - 0.7) / 0.3); // 받침 ㅁ·ㅂ·ㅍ: 끝에 닫음
        want = { jaw: sh.jaw * open, width: sh.width, pucker: sh.pucker * open };
      }
      if (this.sylT >= 1) {
        this.prevShape = v.pause
          ? { jaw: 0, width: 0, pucker: 0 }
          : { jaw: v.close ? 0 : v.jaw * SPEECH_OPEN * this.sylScale, width: v.width, pucker: v.pucker };
        this.sylNow = null;
      }
    } else {
      this.prevShape = { jaw: 0, width: 0, pucker: 0 };
    }
    // 목소리 재생 중: 입 벌림을 실제 소리 크기에 맞춘다 (소리가 쉬면 입도 거의 닫힘)
    if (this.voiceMode && this.voiceActive) want.jaw *= Math.min(1, 0.2 + this.voiceLevel * 1.4);
    this.mouth = want;
    // 목표는 깔끔한 입 모양 몇 가지 중 하나, 그 사이는 임계 감쇠 용수철로 잇는다
    // → 툭툭 넘어가지 않고 가속·감속하며 중간 모양을 거쳐 간다 (로봇 같지 않게)
    const target = quantizeMouth(want);
    const w = MOUTH_SPRING;
    const steps = Math.max(1, Math.ceil(dt / 0.008)); // 큰 dt 에서도 안정적으로
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const key of ["jaw", "width", "pucker"] as const) {
        const x = this.mouthOut[key];
        const v = this.mouthVel[key];
        const a = w * w * (target[key] - x) - 2 * w * v;
        this.mouthVel[key] = v + a * h;
        this.mouthOut[key] = x + this.mouthVel[key] * h;
      }
    }
    if (this.mouthOut.jaw < 0) this.mouthOut.jaw = 0;
    return this.mouthOut;
  }

  /** 조용할 때 행동: 대화가 25~40초 없으면 시작, 행동 사이 18~35초 */
  private idleUpdate(t: number, talking: boolean): IdleOut | null {
    if (talking || this.waitingReply) {
      this.idleAct = null;
      return null;
    }
    if (!this.idleAct && t >= this.idleNext && this.presetWeight < 0.1 && this.swayStart < 0) {
      if (!this.idleOrder.length) this.idleOrder = shuffle<IdleName>(["lookAround", "yawn", "bored", "stretch", "hum", "settle", "settle", "drink", "drink"]);
      this.idleAct = { name: this.idleOrder.pop()!, start: t };
      this.settleSide = Math.random() < 0.5 ? -1 : 1;
      if (this.idleAct.name === "yawn") {
        this.onExpression?.("yawn");
        this.tryHand(["yawn"], 0.7); // 손으로 입을 가리며 하품
      } else if (this.idleAct.name === "bored") this.tryHand(["think"], 0.4);
      else if (this.idleAct.name === "drink" && !this.tryHand(["sip"], 1)) this.idleAct = null;
      if (this.idleAct) this.idleSound(this.idleAct.name);
    }
    const act = this.idleAct;
    if (!act) return null;
    const e = t - act.start;
    const len = IDLE_LEN[act.name];
    if (e >= len) {
      this.idleAct = null;
      this.idleNext = t + 18 + Math.random() * 17;
      return null;
    }
    const env = smooth(e / 0.5) * smooth((len - e) / 0.6); // 서서히 시작·마무리
    if (act.name === "lookAround") {
      // 왼쪽 → 오른쪽 → 가운데로 방을 둘러봄
      const side = e < 1.6 ? -1 : e < 3.4 ? 1 : 0;
      const yUp = e < 1.6 ? 0.15 : e < 3.4 ? 0.05 : 0;
      return { look: { x: 0.8 * side, y: yUp }, headFollow: 0.3, headRoll: 0.03 * side * env };
    }
    if (act.name === "yawn") {
      // 숨을 들이쉬며 입을 천천히 벌리고 눈을 감음 → 잠깐 멈춤 → 닫으며 눈을 깜빡
      const open = e < 1.0 ? smooth(e / 1.0) : e < 1.8 ? 1 : 1 - smooth((e - 1.8) / 0.8);
      // 얼굴(입·눈)은 게임 원본 하품이 맡는다 — 원본을 못 쓰면 절차 하품
      const own = this.onExpression ? 0 : 1; // 원본 하품이 있으면 입·눈은 원본이 맡는다
      return {
        jaw: 0.21 * open * own,
        blink: 0.85 * open * own,
        headPitch: 0.09 * open,
        shoulders: 0.35 * open,
        bodyPitch: -0.03 * open,
      };
    }
    if (act.name === "drink") {
      // 머그컵: 컵을 내려다보며 집고 → 마시는 동안 눈을 살짝 감음 → 내려놓으며 다시 앞을 봄
      if (e < 1.2) return { look: { x: -0.35, y: -0.45 }, headFollow: 0.15 };
      if (e < 3.8) return { look: { x: 0, y: -0.1 }, headFollow: 0, blink: 0.45 * smooth((e - 1.4) / 0.4) * smooth((3.6 - e) / 0.3), headPitch: 0.04 * smooth((e - 1.2) / 0.5) };
      return { look: { x: -0.3, y: -0.4 }, headFollow: 0.1 };
    }
    if (act.name === "stretch") {
      // 목 풀기: 어깨를 으쓱 올렸다가 고개를 왼쪽·오른쪽으로 천천히 기울이며 눈을 지그시 감음
      const side = Math.sin((e / len) * Math.PI * 2);
      return {
        headRoll: 0.16 * side * env,
        headPitch: 0.03 * env,
        shoulders: 0.4 * smooth(e / 0.8) * smooth((1.6 - e) / 0.6),
        blink: 0.55 * env,
        look: { x: 0, y: 0.1 },
        headFollow: 0,
      };
    }
    if (act.name === "hum") {
      // 콧노래: 눈을 반쯤 감고 살짝 웃으며 몸을 좌우로 흔듦
      const beat = Math.sin(e * Math.PI * 1.4);
      return {
        bodyRoll: 0.035 * beat * env,
        headRoll: 0.06 * beat * env,
        headYaw: 0.03 * Math.sin(e * Math.PI * 0.7) * env,
        blink: 0.35 * env,
        smile: 0.35 * env,
        look: { x: 0.1 * beat, y: 0.05 },
        headFollow: 0,
      };
    }
    if (act.name === "settle") {
      // 자세 고쳐 앉기: 몸을 살짝 들썩이며 옆으로 비틀었다 제자리로
      const lift = Math.sin(Math.min(1, e / 0.9) * Math.PI);
      return {
        shoulders: 0.3 * lift,
        bodyPitch: -0.03 * lift,
        bodyYaw: 0.05 * this.settleSide * env,
        bodyRoll: 0.02 * this.settleSide * lift,
      };
    }
    // bored: 고개를 기울이고 아래쪽을 보다가 한숨(어깨 올렸다 툭 내림)
    const sigh = e > 1.2 && e < 2.6 ? Math.sin(((e - 1.2) / 1.4) * Math.PI) : 0;
    return {
      look: { x: 0.25, y: -0.3 },
      headFollow: 0.08,
      headRoll: 0.1 * env,
      headPitch: -0.04 * env,
      shoulders: sigh * 0.45 - (e > 2.6 ? 0.15 * env : 0),
    };
  }

  /** 음절·쉼이 시작될 때: 문장부호에 맞춘 말버릇 연기 */
  private onSyllableStart(v: Viseme): void {
    const t = this.t;
    if (!v.pause && this.pendingEmotionMove) {
      const e = this.pendingEmotionMove;
      this.pendingEmotionMove = null;
      this.emotionMove(e);
    }
    if (v.laugh && t - this.lastLaughAt > 1.2) {
      this.lastLaughAt = t;
      this.startGesture("giggle");
      this.tryHand(["giggle", "clapLaugh"], 0.5);
    }
    if (v.pause && v.sentenceEnd) {
      // 문장마다 몸 자세를 살짝 바꾼다 (가만히 굳어 있지 않게)
      this.bodyOffTarget = { yaw: (Math.random() - 0.5) * 0.06, pitch: (Math.random() - 0.3) * 0.03 };
      if (v.mark === "!" && Math.random() < 0.7) this.startGesture("lean");
      else if (v.mark === "?" && Math.random() < 0.6) this.startGesture("tilt");
      // 말이 길어지면 가끔 손짓 (문장 둘 이상 지난 뒤, 감정 손짓 반 + 설명 손짓 반)
      this.sentencesSinceHand++;
      if (this.sentencesSinceHand >= 2 && this.queue.length > 6) {
        const emo = HAND_FOR[this.emotionName] ?? [];
        const pool = v.mark === "?" ? ["think" as HandGesture] : Math.random() < 0.5 && emo.length ? emo : HAND_TALK;
        this.tryHand(pool, 0.35);
      }
    }
    if (v.pause) {
      const mark = v.mark ?? " ";
      if (v.sentenceEnd) {
        this.talkBob = mark === "!" ? 0.8 : 1; // 문장 끝 살짝 끄덕임
        if (this.presetForReply && GAME_FACE_REPEAT.has(this.emotionName) && this.presetWeight > 0.5 && Math.random() < 0.35) {
          this.playGameFace(this.emotionName);
        }
        this.afterSentence = true;
        // 다음 문장은 고개 방향을 살짝 바꿔서 시작
        this.headOffTarget = { yaw: (Math.random() - 0.5) * 0.07, roll: (Math.random() - 0.5) * 0.04 };
      }
      if (mark === "?") {
        this.browKick = 1; // 물음: 눈을 크게 뜨며 고개 갸웃
        this.tiltKick = 1;
        this.tiltDir = Math.random() < 0.5 ? -1 : 1;
      } else if (mark === "!") {
        this.browKick = 1;
      }
      // 멈춤(문장 끝·쉼표)에서는 감정 입꼬리를 드러내고, 띄어쓰기는 다음 낱말에서 다시 정한다
      if (v.sentenceEnd || mark === "," || mark === "…" || mark === "~") this.emoGateTarget = 1;
      this.wordStart = true;
      // 구절 끝에서 눈 깜빡임 (문장 끝은 자주, 쉼표는 가끔)
      const chance = v.sentenceEnd ? 0.7 : mark === "," || mark === "…" ? 0.35 : 0;
      if (chance && this.blinkPhase < 0 && t - this.lastBlinkEnd > 0.9 && Math.random() < chance) this.nextBlink = t;
    } else {
      if (!this.spokeSinceEmotion) this.spokeSinceEmotion = true;
      if (this.wordStart) {
        // 낱말 첫 음절에서 이 낱말에 감정 입꼬리를 실을지 정한다: 미소는 22% 낱말만, 처진 입꼬리는 낱말에 싣지 않음
        this.wordStart = false;
        const smiley = (this.preset?.smile ?? 0) > 0;
        this.emoGateTarget = smiley && Math.random() < 0.22 ? 1 : 0;
      }
    }
    if (!v.pause && this.afterSentence) {
      // 문장 첫 음절: 눈을 살짝 크게 뜨며 말을 시작
      this.afterSentence = false;
      this.browKick = Math.max(this.browKick, 0.5);
      if (this.t > this.glanceUntil && this.t > this.lookAtViewerUntil && this.t > this.nextGlance - 3 && Math.random() < 0.12) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.glance = { x: 0.35 * side, y: 0.4 };
        this.glanceUntil = this.t + 0.45 + Math.random() * 0.2;
      }
    }
  }

  update(dt: number): FaceParams {
    this.t += dt;
    if (this.drinkSighAt > 0 && this.t >= this.drinkSighAt) {
      this.drinkSighAt = -1;
      if (Math.random() < 0.7) this.onSound?.("sigh");
    }
    const t = this.t;
    const target: FaceParams = { ...NEUTRAL_FACE };
    const talking = this.talking;

    // ---- 감정 프리셋 (들어갈 땐 빠르게, 나올 땐 천천히). 말하는 동안은 계속 유지
    if (this.preset && this.presetForReply && talking) this.presetUntil = Math.max(this.presetUntil, t + 2.5);
    const wantW = this.preset && t < this.presetUntil ? 1 : 0;
    this.presetWeight += (wantW - this.presetWeight) * (1 - Math.exp(-dt * (wantW ? 5 : 0.8)));
    if (this.preset && this.presetWeight > 0.001) {
      for (const k of Object.keys(NEUTRAL_FACE) as Array<keyof FaceParams>) {
        const v = this.preset[k];
        if (typeof v === "number") target[k] += v * this.presetWeight;
      }
    }

    // ---- 말하는 동안 감정 입꼬리는 일부 낱말·멈춤에서만 (대부분 음절은 평소 입꼬리)
    if (!talking) this.emoGateTarget = 1;
    this.emoGate += (this.emoGateTarget - this.emoGate) * (1 - Math.exp(-dt * 7));
    target.smile *= this.emoGate;
    // 웃을 때는 아랫눈꺼풀이 올라와 눈이 살짝 가늘어진다 (눈웃음)
    const happy = Math.max(0, (this.preset?.smile ?? 0) * this.presetWeight);
    target.blinkL += happy * 0.22;
    target.blinkR += happy * 0.22;

    // ---- 깜빡임
    if (this.blinkPhase < 0 && t >= this.nextBlink) {
      this.blinkPhase = 0;
      this.blinkDouble = Math.random() < 0.18;
    }
    let blink = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.28; // 한 번 감았다 뜨는 데 0.28초
      const ph = this.blinkPhase;
      blink = ph < 0.4 ? ph / 0.4 : Math.max(0, 1 - (ph - 0.4) / 0.6);
      if (ph >= 1) {
        if (this.blinkDouble) {
          this.blinkDouble = false;
          this.blinkPhase = 0;
        } else {
          this.blinkPhase = -1;
          this.lastBlinkEnd = t;
          this.nextBlink = t + 1.8 + Math.random() * 4.2;
        }
      }
    }
    target.blinkL = Math.max(target.blinkL, blink);
    target.blinkR = Math.max(target.blinkR, blink);

    // ---- 시선 (말하는 동안에는 주로 화면 쪽)
    // 읽기·생각·시선 피하기 연기가 있으면 그쪽을 우선한다
    let look: { x: number; y: number } | null = null;
    let headFollow = 0.03; // 시선을 따라 고개가 돌아가는 정도
    let thinkRoll = 0;
    const idle = this.idleUpdate(t, talking);
    if (idle?.look) {
      look = idle.look;
      headFollow = idle.headFollow ?? 0.1;
    } else if (t < this.readUntil) {
      look = { x: 0.05, y: -0.4 }; // 받은 메시지를 읽음
      headFollow = 0.05;
    } else if (this.waitingReply && t < this.thinkPhaseUntil) {
      // 답을 떠올리는 중: 위쪽 옆으로 시선을 보내고 고개를 살짝 갸웃
      look = { x: 0.38 * this.thinkSide, y: 0.4 };
      headFollow = 0.14;
      thinkRoll = 0.05 * this.thinkSide;
    } else if (this.waitingReply) {
      // 답을 쓰는 중: 채팅을 치며 바로 앞 노트북 화면과 손(키보드)을 번갈아 본다
      if (t >= this.typeLookUntil) {
        const atHands = Math.random() < 0.3;
        this.typeLook = atHands
          ? { x: (Math.random() - 0.5) * 0.15, y: -0.55 }
          : { x: (Math.random() - 0.5) * 0.2, y: -0.22 - Math.random() * 0.08 };
        this.typeLookUntil = t + (atHands ? 0.4 + Math.random() * 0.4 : 0.9 + Math.random() * 1.6);
      }
      look = this.typeLook;
      headFollow = 0.12;
    } else if (talking) {
      // 말하는 중 가끔 시선을 피했다가 돌아옴 (부끄러울 때는 더 자주, 아래로)
      const shy = this.emotionName === "shy" && this.presetWeight > 0.3;
      if (t >= this.nextGlance && t > this.lookAtViewerUntil && t > this.glanceUntil) {
        // 정해진 박자가 느껴지지 않게: 간격·건너뛰기·방향·폭·길이를 매번 다르게
        if (Math.random() < (shy ? 0.85 : 0.6)) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const amp = 0.15 + Math.random() * 0.3;
          this.glance = shy
            ? { x: amp * side * 0.7, y: -0.2 - Math.random() * 0.2 }
            : { x: amp * side, y: (Math.random() - 0.4) * 0.4 };
          this.glanceUntil = t + 0.3 + Math.random() * 0.7;
        }
        const base = shy ? 3 + Math.random() * 5 : 6 + Math.random() * 10;
        this.nextGlance = t + base * (0.7 + Math.random() * 0.6);
      }
      if (t < this.glanceUntil) {
        look = this.glance;
        headFollow = 0.08;
      }
    }
    if (look) {
      this.gazeTarget = look;
      this.nextGaze = t + 0.5; // 연기가 끝나면 곧 평소 시선으로
    } else if (t >= this.nextGaze) {
      this.nextGaze = t + 1.5 + Math.random() * 3.5;
      if (talking || t < this.lookAtViewerUntil || Math.random() < 0.75) {
        this.gazeTarget = { x: (Math.random() - 0.5) * 0.2, y: (Math.random() - 0.5) * 0.15 };
      } else {
        this.gazeTarget = { x: (Math.random() - 0.5) * 1.1, y: (Math.random() - 0.5) * 0.6 };
      }
    }
    // 시선이 크게 옮겨 갈 때는 자주 깜빡인다 (사람은 큰 눈 움직임과 함께 눈을 감았다 뜸)
    const jump = Math.hypot(this.gazeTarget.x - this.lastGazeTarget.x, this.gazeTarget.y - this.lastGazeTarget.y);
    if (jump > 0.3 && this.blinkPhase < 0 && t - this.lastBlinkEnd > 0.6 && Math.random() < 0.45) this.nextBlink = t;
    this.lastGazeTarget = { ...this.gazeTarget };
    // 미세 단속운동: 한곳을 볼 때도 눈동자가 아주 조금씩 톡톡 옮겨 다닌다
    if (t >= this.nextSacc) {
      this.nextSacc = t + 0.35 + Math.random() * 0.9;
      this.sacc = { x: (Math.random() - 0.5) * 0.07, y: (Math.random() - 0.5) * 0.05 };
    }
    const gk = 1 - Math.exp(-dt * 14);
    this.gaze.x += (this.gazeTarget.x + this.sacc.x - this.gaze.x) * gk;
    this.gaze.y += (this.gazeTarget.y + this.sacc.y - this.gaze.y) * gk;
    target.gazeX += this.gaze.x;
    target.gazeY += this.gaze.y;
    // 고개는 눈보다 늦게 따라간다
    const hgk = 1 - Math.exp(-dt * 3.5);
    this.headGaze.x += (this.gaze.x - this.headGaze.x) * hgk;
    this.headGaze.y += (this.gaze.y - this.headGaze.y) * hgk;

    // ---- 고개: 아주 작은 미세 움직임(숨쉬는 정도) + 끄덕임 + 말할 때 음절 리듬
    target.headYaw += Math.sin(t * 0.7) * 0.015 + Math.sin(t * 1.9) * 0.005;
    target.headPitch += Math.sin(t * 0.9 + 1) * 0.01;
    target.headRoll += Math.sin(t * 0.5 + 2) * 0.012;
    // 아주 가끔(30~70초 간격) 고개를 좌우로 천천히 흔든다
    if (this.swayStart < 0 && t >= this.nextSway) {
      if (talking || this.presetWeight > 0.1 || this.idleAct) this.nextSway = t + 5;
      else this.swayStart = t;
    }
    if (this.swayStart >= 0) {
      const ph = (t - this.swayStart) / this.SWAY_LEN;
      if (ph >= 1) {
        this.swayStart = -1;
        this.nextSway = t + 30 + Math.random() * 40;
      } else {
        const env = Math.sin(ph * Math.PI); // 서서히 시작해서 서서히 멈춤
        target.headYaw += Math.sin(ph * Math.PI * 4) * 0.16 * env;
        target.headRoll += Math.sin(ph * Math.PI * 4) * 0.05 * env;
      }
    }
    if (t < this.nodUntil) {
      const ph = (this.nodUntil - t) / 0.7;
      target.headPitch -= Math.sin(ph * Math.PI) * 0.12;
    }
    // 문장 끝 끄덕임(천천히) + 말하는 동안 아주 느린 고개 움직임
    if (this.voiceMode && this.voiceActive) {
      const lv = this.voiceLevel;
      this.levelSlow += (lv - this.levelSlow) * (1 - Math.exp(-dt * 1.5));
      // 소리가 평소보다 확 커지며 올라가는 순간 = 강세
      if (t >= this.accentNext && lv > this.levelSlow * 1.45 + 0.06 && lv > this.levelPrev) {
        this.accentKick = 1;
        this.browKick = Math.max(this.browKick, 0.35);
        this.accentNext = t + 0.55 + Math.random() * 0.5;
      }
      this.levelPrev = lv;
    } else {
      this.levelSlow *= Math.exp(-dt * 2);
    }
    this.accentKick *= Math.exp(-dt * 5);
    // 강세 끄덕임: 고개가 아래로 살짝 떨어졌다 돌아옴 + 상체가 아주 조금 앞으로
    target.headPitch -= Math.sin(Math.min(1, this.accentKick) * Math.PI) * 0.045;
    target.bodyPitch += Math.sin(Math.min(1, this.accentKick) * Math.PI) * 0.012;
    this.talkBob *= Math.exp(-dt * 3.5);
    target.headPitch -= Math.sin(Math.min(1, this.talkBob) * Math.PI) * 0.035;
    if (talking) {
      target.headYaw += Math.sin(t * 1.1) * 0.02;
      target.headPitch += Math.sin(t * 1.6 + 0.7) * 0.012;
    } else {
      this.headOffTarget = { yaw: 0, roll: 0 };
      this.afterSentence = true;
    }
    // 문장마다 바뀌는 고개 방향(천천히 따라감)
    const hk = 1 - Math.exp(-dt * 2.5);
    this.headOff.yaw += (this.headOffTarget.yaw - this.headOff.yaw) * hk;
    this.headOff.roll += (this.headOffTarget.roll - this.headOff.roll) * hk;
    target.headYaw += this.headOff.yaw;
    target.headRoll += this.headOff.roll;
    // 물음표: 고개 갸웃 (1.2초 정도에 걸쳐 들어갔다 풀림)
    this.tiltKick *= Math.exp(-dt * 1.6);
    target.headRoll += Math.sin(Math.min(1, this.tiltKick) * Math.PI * 0.5) * 0.07 * this.tiltDir;
    // 눈 크게 뜨기 (속눈썹 선을 살짝 올림). 감정 프리셋의 brow 와 더한다. 내리는 쪽은 쓰지 않음
    this.browKick *= Math.exp(-dt * 3);
    target.brow = Math.min(1, Math.max(0, target.brow + this.browKick * 0.7));
    // 시선을 멀리 보낼 때 고개는 아주 조금만 따라간다 (가만히 있는 느낌 유지)
    target.headYaw += this.headGaze.x * headFollow;
    if (look) target.headPitch += this.headGaze.y * headFollow * 0.5; // 위를 보면 고개도 살짝 들림
    this.thinkRollCur += (thinkRoll - this.thinkRollCur) * (1 - Math.exp(-dt * 3));
    target.headRoll += this.thinkRollCur;

    // ---- 몸짓 (프리셋은 자세, 여기는 움직임)
    const body: BodyOut = { bodyPitch: 0, bodyRoll: 0, bodyYaw: 0, shoulders: 0, headPitch: 0, headRoll: 0, headYaw: 0 };
    this.gestures = this.gestures.filter((g) => t - g.start < g.len);
    for (const g of this.gestures) gestureBody(g, t, body);
    const kb = 1 - Math.exp(-dt * 1.5);
    this.bodyOff.yaw += (this.bodyOffTarget.yaw - this.bodyOff.yaw) * kb;
    this.bodyOff.pitch += (this.bodyOffTarget.pitch - this.bodyOff.pitch) * kb;
    if (!talking && !this.waitingReply) {
      // 말을 마치면 몸 자세는 천천히 가운데로
      this.bodyOffTarget.yaw *= 1 - (1 - Math.exp(-dt * 0.5));
      this.bodyOffTarget.pitch *= 1 - (1 - Math.exp(-dt * 0.5));
    }
    target.bodyPitch += body.bodyPitch + this.bodyOff.pitch;
    target.bodyRoll += body.bodyRoll;
    target.bodyYaw += body.bodyYaw + this.bodyOff.yaw;
    target.shoulders += body.shoulders;
    target.headPitch += body.headPitch;
    target.headRoll += body.headRoll;
    target.headYaw += body.headYaw;

    // ---- 립싱크
    const m = this.updateMouth(dt);
    if (talking || m.jaw > 0 || this.spokeSinceEmotion) {
      // 말하는 동안은 애니메이션식 입 모양만 쓴다 (감정 표정의 입 벌림이 섞이면 입이 다시 매끄럽게 흐물거림)
      target.jaw = m.jaw;
      target.pucker = m.pucker;
    }
    target.mouthWidth = m.width; // 말하는 입 폭 (미소와 별개)

    // ---- 조용할 때 행동: 입·눈·고개·어깨
    if (idle) {
      if (idle.jaw) {
        target.jaw = Math.max(target.jaw, idle.jaw);
        target.mouthWidth = -0.1;
      }
      if (idle.blink) {
        target.blinkL = Math.max(target.blinkL, idle.blink);
        target.blinkR = Math.max(target.blinkR, idle.blink);
      }
      target.headPitch += idle.headPitch ?? 0;
      target.headRoll += idle.headRoll ?? 0;
      target.headYaw += idle.headYaw ?? 0;
      target.shoulders += idle.shoulders ?? 0;
      target.bodyPitch += idle.bodyPitch ?? 0;
      target.bodyRoll += idle.bodyRoll ?? 0;
      target.bodyYaw += idle.bodyYaw ?? 0;
      target.smile += idle.smile ?? 0;
    }

    // ---- 채팅 치는 자세: 메시지를 읽고 난 뒤 답이 나오기 전까지 (들어갈 땐 0.6초, 풀 땐 0.8초 정도)
    // 읽기와 답 떠올리기(위쪽 옆을 볼 때)가 끝난 뒤부터 친다
    const wantType = this.waitingReply && t >= this.readUntil && t >= this.thinkPhaseUntil ? 1 : 0;
    // 손이 경로(몸 쪽 → 위 → 키보드)를 따라가도록 너무 빠르지 않게 (약 1.2초)
    this.typingWeight += (wantType - this.typingWeight) * (1 - Math.exp(-dt * 2.5));
    if (this.typingWeight > 0.001) {
      target.bodyPitch += 0.08 * this.typingWeight; // 책상 쪽으로 살짝 숙임
      target.headPitch -= 0.05 * this.typingWeight;
    }

    // ---- 숨쉬기: 3.8초 주기로 어깨·가슴이 살짝 오르내림 (말하는 동안은 작게)
    this.breathPhase += (dt * Math.PI * 2) / 3.8;
    const inhale = 0.5 - 0.5 * Math.cos(this.breathPhase); // 0 날숨 ~ 1 들숨
    const bAmp = talking ? 0.5 : 1;
    target.shoulders += inhale * 0.3 * bAmp;
    target.bodyPitch -= inhale * 0.02 * bAmp; // 들이쉴 때 가슴이 살짝 펴짐

    // ---- 게임 원본 표정이 나오는 동안은 절차 깜빡임·눈 뜨기·미소를 그만큼 줄인다 (둘이 겹치면 어색함)
    const ov = Math.min(1, this.faceOverlay);
    if (ov > 0) {
      target.blinkL *= 1 - ov;
      target.blinkR *= 1 - ov;
      target.brow *= 1 - ov;
      target.smile *= 1 - Math.min(1, this.faceOverlayMouth);
    }

    // ---- 부드럽게
    const k = 1 - Math.exp(-dt * 10);
    for (const key of Object.keys(target) as Array<keyof FaceParams>) {
      // 깜빡임과 입은 즉각 반응 (입은 updateMouth 에서 이미 부드럽게 함)
      const fast = key === "blinkL" || key === "blinkR" || key === "jaw" || key === "pucker" || key === "mouthWidth";
      this.cur[key] += (target[key] - this.cur[key]) * (fast ? 1 : k);
    }
    return this.cur;
  }
}
