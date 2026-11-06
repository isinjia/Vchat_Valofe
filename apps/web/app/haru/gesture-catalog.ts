/**
 * 말할 때 쓰는 손 제스처 목록 — 하루 원본 몸짓 동작(GLB 애니메이션)에서 앉은 자세에 어울리는 구간만 골랐다.
 * 재생할 때는 쓰는 팔·손만 원본을 따르고(얼굴·머리카락 제외), 쓰지 않는 손은 키보드 위에 그대로 둔다.
 * 척추·목·머리는 원본이 움직인 만큼을 spine 배율로 조금만 더한다.
 * 구간은 원본 동작을 앉은 하루에게 입혀 0.1초 단위로 찍어 보고 골랐다.
 * 뺀 것: 주먹 화이팅(주먹이 책상 아래로), 두 손 번쩍(팔을 옆으로 쭉 뻗어 허수아비 같음),
 * 가슴에 손 얹기(팔이 가슴 아래를 가로지름), 눈 비비기(두 팔이 얼굴 전체를 가림), 손가락 꼼지락(무슨 동작인지 알아보기 어려움)
 */
import type { HandPoseDef } from "./typing-pose";

export interface GestureDef {
  /** GLB 안 애니메이션 이름 */
  clip: string;
  /** 쓸 구간(초) */
  from: number;
  to: number;
  /** 쓰는 손: L = 하루 왼손(화면 오른쪽), R = 오른손, both = 두 손 */
  arms: "L" | "R" | "both";
  /** 구간을 몇 번 되풀이할지 (손 흔들기처럼 짧게 반복하는 동작) */
  repeat?: number;
  /** 척추·목·머리 움직임 배율 (기본 0.6). 원본이 고개를 깊이 숙이는 동작은 낮춘다 */
  spine?: number;
  /** 재생 속도 배율 (기본 0.6 — 원본보다 느리게) */
  speed?: number;
  /**
   * 손 위치 보정(m, 장면 기준 +X 하루 왼쪽·+Y 위·+Z 앞). 원본 동작 위에 팔을 다시 계산해 손만 옮긴다.
   * 앉은 하루는 서 있는 원본과 몸 비율·자세가 달라 얼굴로 가는 손이 얼굴에 파묻히거나 자리가 어긋난다.
   */
  reach?: { L?: readonly [number, number, number]; R?: readonly [number, number, number] };
  /**
   * 손가락 굽힘 보정(라디안, +면 손바닥 쪽으로 굽힘). 이름은 손가락 뼈 이름 뒤쪽 (Finger0 = 엄지 첫 마디, Finger01 = 엄지 끝 마디,
   * Finger1·11 = 검지, 2 = 중지, 3 = 약지, 4 = 새끼)
   */
  curl?: { L?: Readonly<Record<string, number>>; R?: Readonly<Record<string, number>> };
  /** 손가락 꼼지락 세기(라디안) — 원본에서 손가락이 굳어 있는 동작에 살짝 움직임을 더한다 */
  fingers?: number;
  /** 손을 올리고 내리는 도중에만 더하는 우회(m) — 키보드에서 머리로 가는 손이 얼굴 앞을 지나가지 않게 */
  arc?: { L?: readonly [number, number, number]; R?: readonly [number, number, number] };
}

const HEART_CURL = {
  Finger0: -0.25, Finger01: -0.3, Finger1: 0.4, Finger11: 0.8,
  Finger2: 0.3, Finger21: 0.5, Finger3: 0.3, Finger31: 0.5, Finger4: 0.3, Finger41: 0.5,
};

export const GESTURES = {
  clapLaugh: { clip: "laugh", from: 0.5, to: 1.4, arms: "both", reach: { L: [0, 0.02, 0.09], R: [0, 0.02, 0.09] } }, // 손 모으고 웃기 (원본은 팔목이 가슴에 파묻힘 → 앞으로)
  giggle: { clip: "laugh", from: 2.1, to: 3.4, arms: "L", spine: 0.35, reach: { L: [0, -0.02, 0.03] } }, // 입 가리고 킥킥 (원본은 손가락이 코에 파묻힘)
  shy: { clip: "g_shy", from: 1.3, to: 3.3, arms: "R", spine: 0.3, reach: { R: [0, 0.01, 0.05] } }, // 수줍게 가슴에 손 (아래팔이 가슴을 뚫어 앞으로)
  please: { clip: "g_please", from: 2.6, to: 5.0, arms: "both", spine: 0.15, reach: { L: [0, 0.01, 0.06], R: [0, 0.01, 0.06] } }, // 두 손 모아 부탁 (원본은 고개를 깊이 숙이고 손이 가슴에 파묻힘)
  scratch: { clip: "idle2", from: 5.3, to: 6.5, arms: "L", spine: 0.5, reach: { L: [0.03, 0.09, 0] }, arc: { L: [0.12, 0, -0.03] } }, // 머리 긁적 (원본은 팔이 이마를 가림, 뒤통수로 옮기면 손이 머리카락에 파묻힘 → 정수리 위로. 끝에 손을 들어 올리는 부분은 뺌)
  // 하트 손: 원본에서 하트가 완성된 순간(1.95~2.15초)만 아주 느리게 재생해 하트를 유지하고, 눈높이에서 입 앞으로 내린다. 원본은 몸을 옆으로 비틀어 척추 움직임은 뺀다(정면).
  // 원본 손 모양은 정면에서 동그라미로 보여, 엄지를 굽혀 아래를 뾰족하게, 검지 끝을 안으로 말아 위 가운데를 오목하게 만든다.
  heart: { clip: "g_heart", from: 1.95, to: 2.15, arms: "both", speed: 0.08, spine: 0, reach: { L: [0.015, -0.07, 0.02], R: [-0.015, -0.07, 0.02] }, curl: { L: HEART_CURL, R: HEART_CURL } },
  tear: { clip: "sad", from: 2.3, to: 4.0, arms: "R", spine: 0.2 }, // 이마 짚기 (앞쪽은 팔로 얼굴을 가로질러 뺌)
  yawn: { clip: "laugh", from: 2.1, to: 3.4, arms: "L", spine: 0.35, reach: { L: [0, -0.03, 0.025] } }, // 하품하며 한 손으로 입 가리기
  // 눈·입 가리기: 원본은 두 손이 같은 깊이에서 서로 파고들어, 왼손을 앞으로 빼 엇갈려 포개지게 한다
  coverEyes: { clip: "g_cover", from: 2.5, to: 3.6, arms: "both", spine: 0.1, reach: { L: [0, 0.055, 0.07], R: [0, 0.05, 0.022] }, fingers: 0.22 }, // 손으로 눈 가리기 (원본 그대로면 입을 가림)
  coverMouth: { clip: "g_cover", from: 2.5, to: 3.6, arms: "both", spine: 0.1, reach: { L: [0, -0.01, 0.06], R: [0, -0.015, 0.014] }, fingers: 0.15 }, // 놀라 두 손으로 입 가리기
  raise: { clip: "g_raise", from: 0, to: 1.83, arms: "R" }, // 한 손 번쩍
  think: { clip: "laugh", from: 2.7, to: 2.78, arms: "L", spine: 0.2, speed: 0.025, reach: { L: [0.01, -0.075, 0.03] }, curl: { L: { Finger1: -0.6, Finger11: -0.5 } } }, // 검지로 턱 짚고 고민 (입 가리는 손을 턱으로 내리고 검지를 편다. 원본은 킥킥대며 손이 들썩여 한순간만 아주 느리게)
  explain: { clip: "g_explain", from: 5.4, to: 6.7, arms: "L", spine: 0.3 }, // 손바닥 내밀어 설명
} as const satisfies Record<string, GestureDef>;

export type GestureKey = keyof typeof GESTURES;

/**
 * 직접 계산하는 손짓 — 원본 몸짓을 잘라 쓰면 앉은 하루와 비율이 안 맞아 손이 몸을 뚫거나 어긋나서,
 * 손목 자리·팔꿈치 방향·손가락 방향·엄지 방향·손가락 굽힘을 숫자로 정한다 (왼손 기준, 장면 m).
 * 손가락 굽힘 이름 뒤에 ":y"·":x" 를 붙이면 그 축으로 돌린다 (검지·중지 :y 는 옆으로 벌림).
 * 하루 어깨 0.84m, 머리 뼈 0.94m, 턱 약 0.92m, 키보드 0.77m.
 */
const FIST = { Finger1: 1.35, Finger11: 1.4, Finger2: 1.35, Finger21: 1.4, Finger3: 1.35, Finger31: 1.4, Finger4: 1.35, Finger41: 1.4 };
export const HAND_POSES = {
  // 브이: 얼굴 옆에서 검지·중지를 펴고 손바닥을 화면 쪽으로
  peace: {
    side: 1, target: [0.15, 0.955, 0.1], pole: [0.3, -1, 0.3], finger: [0.15, 1, 0.05], thumb: [-1, 0, 0.2],
    curl: { Finger3: 1.35, Finger31: 1.4, Finger4: 1.35, Finger41: 1.4, Finger0: 0.5, Finger01: 0.6, "Finger1:y": 0.22, "Finger2:y": -0.22,
      Finger1: -0.5, Finger11: -0.5, Finger2: -0.5, Finger21: -0.5 }, // 앉은 자세는 손가락이 말려 있어 검지·중지를 곧게 편다
    rise: 0.6, hold: 2.2, fall: 0.7, bob: { amp: [0, 0.006, 0], hz: 1.1 },
  },
  // 엄지척: 가슴 앞에서 주먹 쥐고 엄지를 위로. 말린 손가락이 화면 쪽을 보게 (손등이 보이면 어색함)
  thumbsUp: {
    side: 1, target: [0.03, 0.8, 0.1], pole: [1, -0.6, -0.2], finger: [-0.8, 0, 0.6], thumb: [0, 1, 0], // 가슴 가운데 명치 앞, 팔꿈치는 옆으로 벌림 (붙이면 어색함)
    curl: { ...FIST, Finger0: -0.9, Finger01: -0.3 },
    rise: 0.55, hold: 1.8, fall: 0.65, bob: { amp: [0, 0.008, 0.004], hz: 1.4 },
  },
  // 머그컵 마시기: 오른손으로 노트북 오른쪽 머그컵을 집어 입가로 가져가 홀짝 (컵 자리는 HaruStream 의 MUG_SPOT)
  sip: {
    side: -1, grab: [0.28, 0.749, 0.14], grabLift: 0.07, target: [0.052, 0.918, 0.025], pole: [0.7, -1, -0.25], // 컵은 몸 가까이(팔꿈치를 굽힌 채 집음)
    grabFinger: [0.1, -0.1, 1], grabThumb: [0, 1, 0], // 집을 때 손가락은 아래팔을 이어 앞으로 (손목이 덜 꺾임)
    finger: [-0.3, 0.9, 0.1], thumb: [0, 0.6, -0.8], // 손가락은 아래팔을 이어 거의 위로(손목이 곧음), 컵 기울기는 HaruStream 에서 43도까지만. 손목 자리는 컵 테두리가 입술에 닿게 계산한 값
    curl: { Finger1: 0.9, Finger11: 0.9, Finger2: 0.95, Finger21: 0.95, Finger3: 1.0, Finger31: 1.0, Finger4: 1.05, Finger41: 1.05, Finger0: 0, Finger01: -0.2 },
    rise: 1.8, hold: 1.6, fall: 1.8, bob: { amp: [0, 0.004, 0], hz: 0.6 },
  },
} as const satisfies Record<string, HandPoseDef>;
export type PoseKey = keyof typeof HAND_POSES;
/** 손 제스처 전체: 위 목록 + 직접 계산하는 손 흔들기 (원본 손 흔들기는 가슴 앞에서 손을 옆으로 젓는 동작이라 앉은 하루에게 어색해 뺐다) */
export type HandGesture = GestureKey | PoseKey | "wave";
