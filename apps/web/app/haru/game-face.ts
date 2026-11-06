/**
 * 게임 원본 표정 층 — 하루 몸짓 동작(GLB 애니메이션)에서 얼굴 뼈(Bip01 Xtra##) 움직임만, 좋은 구간만 잘라
 * 앉아 있는 하루 얼굴에 덧입힌다. 몸은 건드리지 않는다.
 *
 *  - 눈 부분(눈꺼풀 Xtra01~04, 속눈썹 선 Xtra08·09)과 입 부분(턱 Xtra07, 입술·이 Xtra10~19)을 따로 둔다.
 *    말하는 동안에는 눈 표정만 쓰고 입은 립싱크가 맡는다.
 *  - 눈동자(Xtra05·06)는 넣지 않는다 (시선은 auto-actor 가 맡음).
 *
 * 매 프레임 순서: 몸 mixer.update → GameFace.update(dt, talking) → model.updateMatrixWorld → FaceRig.apply
 */
import type * as T from "three";

type Three = typeof import("three");

/** 표정 이름 → 원본 동작과 구간(초). 구간은 얼굴을 0.33초 간격으로 찍어 보고 골랐다 */
export const GAME_FACES = {
  // 원본 입은 크게 벌리고 웃어 과해 보여(사용자 지적) 입 부분 세기를 줄였다
  joyEyes: { clip: "cheer", from: 1.75, to: 2.85, mouthScale: 0.4 }, // 웃으며 눈을 감는 눈웃음(^^)
  smile: { clip: "laugh", from: 0.55, to: 1.5, mouthScale: 0.4, eyeScale: 0.5 }, // 눈을 뜬 채 입꼬리 올린 미소 (눈을 너무 크게 떠서 절반만)
  wink: { clip: "cheer", from: 0.1, to: 0.65, mouthScale: 0.45 }, // 윙크
  sad: { clip: "sad", from: 2.5, to: 6.1, mouthScale: 0.5 }, // 눈을 지그시 감고 입을 오므림
  // 하품: 원본 입 모양 그대로, 벌림만 절반 (원본 그대로는 너무 크게 벌림 — 사용자 의견)
  yawn: { clip: "sit_idle", from: 0.85, to: 2.55, mouthScale: 0.5 },
  surprised: { clip: "maid", from: 9.8, to: 10.2, mouthScale: 0.5, eyeScale: 0.55 }, // 눈을 크게 뜸 (원본 그대로면 윗눈꺼풀이 너무 올라가 흰자 테두리가 보임)
  shy: { clip: "maid", from: 3.4, to: 4.6, mouthScale: 0.5 }, // 눈을 감고 입을 작게 벌림
  soft: { clip: "hello", from: 1.55, to: 2.45 }, // 부드럽게 내려 뜬 눈
} as const;
export type GameFaceName = keyof typeof GAME_FACES;

const EYE_BONE = /xtra0[1-4]|xtra0[89]/i;
const MOUTH_BONE = /xtra07|xtra1[0-9]/i;
const FADE_IN = 0.2;
const HOLD_AT = 0.7;
const FADE_OUT = 0.7; // 표정이 풀리는 시간 (짧으면 원래 얼굴로 확 돌아가 어색함)

interface Sampler {
  fi: number; // faceBones 번호
  quat: boolean;
  ev: (t: number) => ArrayLike<number>;
}
interface Built {
  eyes: Sampler[];
  mouth: Sampler[];
  from: number;
  dur: number;
  /** 입 부분 세기 배율 (1 미만이면 원본보다 덜 벌림 — 다문 입 쪽으로 섞음) */
  mouthScale: number;
  /** 눈 부분 세기 배율 */
  eyeScale: number;
}

/**
 * 원본 표정은 애니메이션 믹서를 거치지 않고 원본 트랙을 직접 읽어 얼굴 뼈에 섞는다.
 * 믹서에 맡기면 (1) 표정을 바꾸는 순간의 일그러진 얼굴이 '원래 자세'로 저장돼 표정이 쌓이고,
 * (2) 시간을 멈추면 뼈가 원래 자리로 튀고, (3) 다시 뽑은 트랙에서 눈꺼풀이 순간적으로 떨렸다.
 */
export class GameFace {
  private readonly built = new Map<GameFaceName, Built>();
  private cur: { name: GameFaceName; t: number; b: Built } | null = null;
  /** 지금 얼굴 표정 층의 세기 (0~1) — auto-actor 가 절차 표정(깜빡임 등)을 그만큼 줄이는 데 쓴다 */
  weight = 0;
  /** 지금 입 부분까지 쓰는지 */
  mouthWeight = 0;
  /** 표정이 움직이는 얼굴 뼈와 그 기본 자세(처음 update 때의 값 = 앉은 자세의 무표정) */
  private readonly faceBones: Array<{ bone: T.Object3D; eye: boolean; restP: T.Vector3; restQ: T.Quaternion; animP: T.Vector3; animQ: T.Quaternion }> = [];
  private restReady = false;

  constructor(THREE: Three, model: T.Object3D, clips: T.AnimationClip[]) {
    const index = new Map<string, number>();
    for (const [name, def] of Object.entries(GAME_FACES) as Array<[GameFaceName, (typeof GAME_FACES)[GameFaceName]]>) {
      const src = clips.find((c) => c.name === def.clip);
      if (!src) continue;
      const dur = Math.max(0.1, Math.min(def.to, src.duration) - def.from);
      const eyes: Sampler[] = [];
      const mouth: Sampler[] = [];
      for (const t of src.tracks) {
        const [bn, prop] = t.name.split(".");
        const eye = EYE_BONE.test(bn);
        if ((!eye && !MOUTH_BONE.test(bn)) || (prop !== "quaternion" && prop !== "position")) continue;
        let fi = index.get(bn);
        if (fi === undefined) {
          const bone = model.getObjectByName(bn);
          if (!bone) continue;
          fi = this.faceBones.length;
          index.set(bn, fi);
          this.faceBones.push({ bone, eye, restP: new THREE.Vector3(), restQ: new THREE.Quaternion(), animP: new THREE.Vector3(), animQ: new THREE.Quaternion() });
        }
        const interp = (t as unknown as { createInterpolant(): { evaluate(time: number): ArrayLike<number> } }).createInterpolant();
        (eye ? eyes : mouth).push({ fi, quat: prop === "quaternion", ev: (time) => interp.evaluate(time) });
      }
      const mouthScale = "mouthScale" in def ? def.mouthScale : 1;
      const eyeScale = "eyeScale" in def ? def.eyeScale : 1;
      this.built.set(name, { eyes, mouth, from: def.from, dur, mouthScale, eyeScale });
    }
  }

  has(name: string): name is GameFaceName {
    return this.built.has(name as GameFaceName);
  }

  /** 표정 하나 재생 (재생 중이던 표정은 바로 바뀜) */
  play(name: GameFaceName): void {
    const b = this.built.get(name);
    if (!b) return;
    this.cur = { name, t: 0, b };
  }

  get playing(): GameFaceName | null {
    return this.cur?.name ?? null;
  }

  update(dt: number, talking: boolean): void {
    if (!this.restReady) {
      for (const f of this.faceBones) {
        f.restP.copy(f.bone.position);
        f.restQ.copy(f.bone.quaternion);
      }
      this.restReady = true;
    }
    // 얼굴 뼈는 늘 기본 자세에서 출발
    for (const f of this.faceBones) {
      f.bone.position.copy(f.restP);
      f.bone.quaternion.copy(f.restQ);
    }
    const c = this.cur;
    if (!c) {
      this.weight = 0;
      this.mouthWeight = 0;
      return;
    }
    c.t += dt;
    const { dur } = c.b;
    const fin = Math.min(1, c.t / FADE_IN);
    const fout = c.t > dur ? 1 - (c.t - dur) / FADE_OUT : 1;
    const lin = Math.max(0, Math.min(fin, fout));
    const w = lin * lin * (3 - 2 * lin); // 들어가고 풀릴 때 부드럽게
    if (w <= 0 && c.t > dur) {
      this.cur = null;
      this.weight = 0;
      this.mouthWeight = 0;
      return;
    }
    this.weight = w;
    // 원본 구간 끝쪽에는 눈을 확 다시 뜨는 장면이 들어 있어, 그 앞(70%)에서 표정을 멈춰 둔 채 천천히 풀어 간다
    const time = c.b.from + Math.min(c.t, dur * HOLD_AT);
    // 입 부분은 말하지 않을 때만 (말하는 중엔 립싱크가 입을 맡음), 바뀔 때는 부드럽게
    this.mouthWeight += ((talking ? 0 : 1) - this.mouthWeight) * (1 - Math.exp(-dt * 10));
    const we = w * c.b.eyeScale;
    const wm = w * this.mouthWeight * c.b.mouthScale;
    for (const [list, k] of [[c.b.eyes, we], [c.b.mouth, wm]] as const) {
      if (k <= 0) continue;
      for (const s of list) {
        const f = this.faceBones[s.fi];
        const v = s.ev(time);
        if (s.quat) {
          f.animQ.set(v[0], v[1], v[2], v[3]).normalize();
          f.bone.quaternion.copy(f.restQ).slerp(f.animQ, k);
        } else {
          f.animP.set(v[0], v[1], v[2]);
          f.bone.position.copy(f.restP).lerp(f.animP, k);
        }
      }
    }
  }
}
