/**
 * 채팅 치는 자세 — 답을 기다리는 동안 하루가 두 손을 책상에 올리고 키보드를 두드린다.
 * 게임에 책상에서 타이핑하는 동작이 없어서 팔을 직접 계산한다 (위팔·아래팔 두 마디 맞추기 + 손 방향).
 *
 * 매 프레임: 몸 mixer → 얼굴 층 → FaceRig.apply(상체 숙임 등) 뒤에 update(dt, weight) 를 부른다.
 * 팔 뼈는 몸 mixer 가 매 프레임 새로 쓰므로 여기서 덮어써도 쌓이지 않는다.
 * 좌표: 모델 바깥(장면) 기준 m. +X = 하루의 왼쪽, +Z = 하루 정면(카메라 쪽).
 */
import type * as T from "three";

type Three = typeof import("three");

function smooth(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

/** 손을 올릴 자리. side +1 = 왼손, -1 = 오른손 */
// 하루 앞으로 옮긴 노트북: 키보드 윗면 0.724m, 하루 쪽 가장자리 z 0.18, 폭 약 ±0.12m.
// 손 뼈(손목)는 손바닥 두께만큼 띄운다. z 는 팔 길이(약 38cm) 안에서 키보드 앞쪽.
const HAND_TARGET = { x: 0.085, y: 0.768, z: 0.22 };
/** 팔꿈치가 향할 쪽 (아래·바깥·조금 뒤) */
const POLE = { x: 0.6, y: -1, z: -0.35 };

// 손 흔들기: 원본 몸짓에 앉아서 손 흔드는 동작이 없어 직접 계산한다.
// 손을 얼굴 옆(어깨 0.84m, 머리 0.94m 기준)으로 들어 손바닥을 화면 쪽으로, 손목·아래팔을 좌우로 흔든다.
// 팔꿈치를 옆구리 아래로 내리고 아래팔을 세운다 (팔꿈치를 어깨 높이로 벌리면 위팔 살이 꺾여 보인다)
const WAVE_TARGET = { x: 0.17, y: 0.95, z: 0.12 };
const WAVE_POLE = { x: 0.2, y: -1, z: 0.35 };
const WAVE_RISE = 0.7; // 손 드는 시간(초)
const WAVE_FALL = 0.8; // 내려놓는 시간(초)
const WAVE_HZ = 1.2; // 흔드는 빠르기(초당 왕복)
const WAVE_SWING = 0.38; // 흔드는 폭(라디안)

/**
 * 직접 계산하는 손짓 하나 (원본 몸짓 없이 팔·손·손가락을 숫자로 정함).
 * 좌표는 장면 기준(m)이고 왼손(side +1) 기준으로 적는다 — 오른손이면 x 를 뒤집는다.
 */
export interface HandPoseDef {
  side: 1 | -1;
  /** 손목 자리 */
  target: readonly [number, number, number];
  /** 팔꿈치가 향할 쪽 */
  pole: readonly [number, number, number];
  /** 손가락(중지 뿌리)이 향할 쪽 */
  finger: readonly [number, number, number];
  /** 엄지 뿌리가 향할 쪽 (손바닥 방향을 정함) */
  thumb: readonly [number, number, number];
  /** 손가락 굽힘(라디안, +면 손바닥 쪽) — 이름은 손가락 뼈 이름 뒤쪽 */
  curl?: Readonly<Record<string, number>>;
  /** 올리기·유지·내리기(초) */
  rise: number;
  hold: number;
  fall: number;
  /** 물건 집기: 올릴 때 먼저 이 자리(손목)로 가서 집고, 내릴 때 여기에 내려놓는다 */
  grab?: readonly [number, number, number];
  /** 집을 때 손가락 방향·엄지 방향 (없으면 finger·thumb) */
  grabFinger?: readonly [number, number, number];
  grabThumb?: readonly [number, number, number];
  /** 집으러 갈 때 손을 들어 올리는 높이(m) */
  grabLift?: number;
  /** 유지하는 동안 손목이 살짝 오가는 폭(m)과 빠르기(초당 왕복) */
  bob?: { amp: readonly [number, number, number]; hz: number };
}

interface Arm {
  side: 1 | -1;
  clav: T.Bone | null; // 쇄골 (팔을 벌릴 때 같이 들어 어깨가 접히지 않게)
  upper: T.Bone;
  fore: T.Bone;
  hand: T.Bone;
  tip: T.Bone | null; // 손가락 끝 쪽 (손 방향 맞추기)
  thumb: T.Bone | null; // 엄지 (손바닥 방향 맞추기)
  fingers: T.Bone[][]; // 검지~새끼 손가락 마디 (꼼지락)
  phase: number;
  prevTap: number; // 지난 프레임 손가락 두드림 (키 누름 순간 찾기)
}

export class TypingPose {
  private readonly THREE: Three;
  private readonly arms: Arm[] = [];
  /** 손가락이 키를 누르는 순간 (side, 세기 0~1) — 키보드 소리용 */
  onKey?: (side: 1 | -1, strength: number) => void;
  private t = 0;
  /** 손 흔들기 상태: e = 시작 뒤 지난 시간(-1 이면 안 흔드는 중), fallAt = 내려놓기 시작할 때 */
  private wave = { side: 1 as 1 | -1, e: -1, fallAt: 0 };
  /** 직접 계산하는 손짓: e = 시작 뒤 지난 시간(-1 이면 안 함), fallAt = 내려놓기 시작할 때 */
  private pose: { def: HandPoseDef; e: number; fallAt: number } | null = null;
  private readonly v = {
    s: null as unknown as T.Vector3,
    e: null as unknown as T.Vector3,
    h: null as unknown as T.Vector3,
    p: null as unknown as T.Vector3,
    a: null as unknown as T.Vector3,
    b: null as unknown as T.Vector3,
    pole: null as unknown as T.Vector3,
  };
  private readonly q1: T.Quaternion;
  private readonly q2: T.Quaternion;
  private readonly qRest: T.Quaternion;
  private readonly axisZ: T.Vector3;
  private readonly axisX: T.Vector3;
  private readonly axisY: T.Vector3;
  private readonly model: T.Object3D;
  private readonly boneCache = new Map<string, T.Bone | null>();
  private readonly rotMem = new Map<T.Bone, { before: T.Quaternion; after: T.Quaternion; used: boolean; frame: number }>();
  private frame = 0; // update 마다 하나씩 — 한 프레임에 같은 뼈를 여러 번 돌릴 때 되돌리기는 처음 한 번만
  readonly ok: boolean;

  constructor(THREE: Three, model: T.Object3D) {
    this.THREE = THREE;
    for (const k of Object.keys(this.v) as Array<keyof typeof this.v>) this.v[k] = new THREE.Vector3();
    this.q1 = new THREE.Quaternion();
    this.q2 = new THREE.Quaternion();
    this.qRest = new THREE.Quaternion();
    this.axisZ = new THREE.Vector3(0, 0, 1);
    this.axisX = new THREE.Vector3(1, 0, 0);
    this.axisY = new THREE.Vector3(0, 1, 0);
    this.model = model;
    for (const [side, s] of [[1, "L"], [-1, "R"]] as const) {
      const upper = model.getObjectByName(`Bip01_${s}_UpperArm`) as T.Bone | undefined;
      const clav = (model.getObjectByName(`Bip01_${s}_Clavicle`) as T.Bone | undefined) ?? null;
      const fore = model.getObjectByName(`Bip01_${s}_Forearm`) as T.Bone | undefined;
      const hand = model.getObjectByName(`Bip01_${s}_Hand`) as T.Bone | undefined;
      const tip = (model.getObjectByName(`Bip01_${s}_Finger2`) as T.Bone | undefined) ?? null;
      const thumb = (model.getObjectByName(`Bip01_${s}_Finger0`) as T.Bone | undefined) ?? null;
      const fingers = [1, 2, 3, 4].map((i) =>
        [`Bip01_${s}_Finger${i}`, `Bip01_${s}_Finger${i}1`].map((n) => model.getObjectByName(n) as T.Bone | undefined).filter((b): b is T.Bone => !!b),
      );
      if (upper && fore && hand) this.arms.push({ side, clav, upper, fore, hand, tip, thumb, fingers, phase: Math.random() * 10, prevTap: 0 });
    }
    this.ok = this.arms.length === 2;
  }

  /**
   * 손은 늘 키보드 위에 둔다. weight(0~1)는 손가락 두드림 세기 — 채팅 칠 때 1, 쉴 때 0.
   * releaseL·R(0~1)는 왼손·오른손을 키보드에서 떼는 정도 — 말하며 손 제스처를 할 때 1 (그동안은 몸 애니메이션 팔 자세를 따름)
   */
  update(dt: number, weight: number, releaseL = 0, releaseR = 0): void {
    this.t += dt;
    this.frame++;
    // 지난 프레임에 우리가 돌려 둔 뼈 중 몸 애니메이션이 덮어쓰지 않은 것은 원래대로 (손짓이 끝나면 손이 제자리로)
    for (const [b, mem] of this.rotMem) {
      if (mem.used && b.quaternion.equals(mem.after)) b.quaternion.copy(mem.before);
      mem.used = false;
    }
    if (!this.ok) return;
    const wv = this.wave;
    let waveK = 0;
    if (wv.e >= 0) {
      wv.e += dt;
      waveK = smooth(wv.e / WAVE_RISE) * (1 - smooth((wv.e - wv.fallAt) / WAVE_FALL));
      if (wv.e > wv.fallAt + WAVE_FALL) wv.e = -1;
    }
    const ps = this.pose;
    let poseK = 0;
    if (ps) {
      ps.e += dt;
      poseK = smooth(ps.e / ps.def.rise) * (1 - smooth((ps.e - ps.fallAt) / ps.def.fall));
      this.poseK = poseK;
      if (ps.e > ps.fallAt + ps.def.fall) this.pose = null;
    }
    for (const arm of this.arms) {
      if (this.pose && arm.side === this.pose.def.side) {
        this.solvePose(arm, this.pose, poseK);
        continue;
      }
      if (wv.e >= 0 && arm.side === wv.side) {
        this.solve(arm, weight, 1, waveK); // 흔드는 손은 키보드 자리에서 이어서 직접 움직인다
        continue;
      }
      const rel = arm.side === 1 ? releaseL : releaseR;
      if (rel < 0.998) this.solve(arm, weight, 1 - rel);
    }
  }

  /**
   * 지금 팔 자세(몸 애니메이션)에서 손만 off(m)만큼 옮긴다 — 팔꿈치가 굽은 방향은 그대로, 손 방향도 그대로.
   * side +1 = 왼손. w(0~1)만큼만.
   */
  nudge(side: 1 | -1, off: readonly [number, number, number] | undefined, w: number, arc?: readonly [number, number, number]): void {
    const arm = this.arms.find((a) => a.side === side);
    if (!arm || w <= 0.001 || (!off && !arc)) return;
    // 우회는 옮기는 도중(w 가 0 과 1 사이)에만 — 가운데에서 가장 크다
    const mid = 4 * w * (1 - w);
    const ox = (off?.[0] ?? 0) * w + (arc?.[0] ?? 0) * mid;
    const oy = (off?.[1] ?? 0) * w + (arc?.[1] ?? 0) * mid;
    const oz = (off?.[2] ?? 0) * w + (arc?.[2] ?? 0) * mid;
    const { s, e, h, p, a, b, pole } = this.v;
    arm.upper.updateMatrixWorld(true);
    arm.upper.getWorldPosition(s);
    arm.fore.getWorldPosition(e);
    arm.hand.getWorldPosition(h);
    const handW = arm.hand.getWorldQuaternion(new this.THREE.Quaternion());
    p.set(h.x + ox, h.y + oy, h.z + oz);
    const la = s.distanceTo(e);
    const lb = e.distanceTo(h);
    const d = Math.min(Math.max(s.distanceTo(p), 0.02), (la + lb) * 0.995);
    // 지금 팔꿈치가 굽은 쪽을 그대로 쓴다
    const cur = a.subVectors(h, s).normalize();
    pole.subVectors(e, s);
    pole.addScaledVector(cur, -pole.dot(cur));
    const dir = a.subVectors(p, s).normalize();
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-10) return;
    pole.normalize();
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const elbow = b.copy(s).addScaledVector(dir, la * cosA).addScaledVector(pole, la * sinA);
    this.aim(arm.upper, s, e, elbow, 1);
    arm.fore.updateMatrixWorld(true);
    arm.fore.getWorldPosition(e);
    arm.hand.getWorldPosition(h);
    this.aim(arm.fore, e, h, p, 1);
    // 손 방향은 원래대로
    const parentW = new this.THREE.Quaternion();
    arm.hand.parent?.getWorldQuaternion(parentW);
    this.touch(arm.hand);
    arm.hand.quaternion.copy(parentW.invert().multiply(handW));
    arm.hand.updateMatrixWorld(true);
    this.touchedAfter(arm.hand);
  }

  /** 손가락 마디를 굽힌다. curl = { Finger1: 0.4, ... } (뼈 이름 뒤쪽 → 라디안, +면 손바닥 쪽). w 만큼만 */
  curlFingers(side: 1 | -1, curl: Readonly<Record<string, number>>, w: number): void {
    if (w <= 0.001) return;
    const s = side === 1 ? "L" : "R";
    for (const [k, a] of Object.entries(curl)) {
      // "Finger0:y" 처럼 축을 붙이면 그 로컬 축으로 돌린다 (기본 Z = 손가락 굽힘. 엄지는 Y 가 손바닥 쪽으로 접힘)
      const [bn, ax] = k.split(":");
      const key = `Bip01_${s}_${bn}`;
      let b = this.boneCache.get(key);
      if (b === undefined) {
        b = (this.model.getObjectByName(key) as T.Bone | undefined) ?? null;
        this.boneCache.set(key, b);
      }
      if (!b) continue;
      this.rotLocal(b, a * w, ax === "x" ? this.axisX : ax === "y" ? this.axisY : this.axisZ);
    }
  }

  /**
   * 뼈를 로컬 Z 축으로 더 굽힌다. 몸 애니메이션에 이 뼈 움직임이 없으면 mixer 가 매 프레임 덮어쓰지 않아
   * 굽힘이 계속 쌓여 손가락이 빙글 돈다 — 지난 프레임에 우리가 만든 값 그대로면 먼저 되돌린다.
   */
  private rotLocal(b: T.Bone, angle: number, axis: T.Vector3 = this.axisZ): void {
    const mem = this.touch(b);
    this.q1.setFromAxisAngle(axis, angle);
    b.quaternion.multiply(this.q1);
    mem.after.copy(b.quaternion);
  }

  /** 이 프레임에 처음 건드리는 뼈면 원래 값을 기억한다 (다음 update 첫머리에 되돌릴 기준) */
  private touch(b: T.Bone): { before: T.Quaternion; after: T.Quaternion; used: boolean; frame: number } {
    let mem = this.rotMem.get(b);
    if (!mem) {
      mem = { before: b.quaternion.clone(), after: b.quaternion.clone(), used: false, frame: -1 };
      this.rotMem.set(b, mem);
    }
    if (mem.frame !== this.frame) {
      mem.before.copy(b.quaternion);
      mem.frame = this.frame;
    }
    mem.used = true;
    return mem;
  }

  /** 손가락을 하나씩 엇갈려 살짝 굽혔다 폈다 한다 (amp 라디안 × w). 몸 애니메이션이 매 프레임 손가락을 새로 쓰므로 쌓이지 않는다 */
  wiggleFingers(side: 1 | -1, amp: number, w: number): void {
    const arm = this.arms.find((a) => a.side === side);
    if (!arm || w <= 0.001) return;
    const t = this.t;
    arm.fingers.forEach((segs, i) => {
      const a = (0.5 + 0.5 * Math.sin(t * 4.2 + i * 1.1 + arm.phase)) * amp * w;
      for (const b of segs) this.rotLocal(b, a);
    });
  }

  /** 직접 계산하는 손짓 시작 */
  startPose(def: HandPoseDef): boolean {
    if (this.waving || this.posing) return false;
    this.pose = { def, e: 0, fallAt: def.rise + def.hold };
    return true;
  }

  /** 하던 손짓을 바로 내려놓기 시작 */
  stopPose(): void {
    const ps = this.pose;
    if (ps && ps.e < ps.fallAt) ps.fallAt = ps.e;
  }

  get posing(): boolean {
    return !!this.pose;
  }

  /** 지금 손에 물건을 쥐고 있는지 (집는 손짓의 가운데 구간) — 물건을 손에 붙일 때 쓴다 */
  get holding(): { side: 1 | -1; hand: T.Bone } | null {
    const ps = this.pose;
    if (!ps || !ps.def.grab || this.poseK < 0.5) return null;
    const arm = this.arms.find((a) => a.side === ps.def.side);
    return arm ? { side: arm.side, hand: arm.hand } : null;
  }
  private poseK = 0;

  /** 직접 계산하는 손짓: 키보드 자리에서 정한 자리로 k 만큼 옮기고, 손가락 방향·손바닥 방향·손가락 굽힘을 맞춘다 */
  private solvePose(arm: Arm, ps: { def: HandPoseDef; e: number }, k: number): void {
    const { s, e, h, p, a, b, pole } = this.v;
    const d0 = ps.def;
    const sd = arm.side;
    const bob = d0.bob ? Math.sin(Math.max(0, ps.e - d0.rise * 0.7) * Math.PI * 2 * d0.bob.hz) : 0;
    const bx = (d0.bob?.amp[0] ?? 0) * bob;
    const by = (d0.bob?.amp[1] ?? 0) * bob;
    const bz = (d0.bob?.amp[2] ?? 0) * bob;
    // 집는 손짓: 키보드 → 물건 자리(k 0~0.5) → 정한 자리(k 0.5~1). 물건 자리까지는 살짝 들어 올려 넘어간다
    let from: readonly [number, number, number] = [HAND_TARGET.x, HAND_TARGET.y, HAND_TARGET.z];
    let to: readonly [number, number, number] = [d0.target[0] + bx, d0.target[1] + by, d0.target[2] + bz];
    let kk = k;
    let lift = 0;
    if (d0.grab) {
      if (k < 0.5) {
        // 키보드에서 컵 바깥쪽 위로 먼저 높이 가고(옆으로 60%), 거기서 컵 옆으로 내려와 쥔다 — 옆으로 다가가면 손가락이 컵을 뚫고 지나감
        to = d0.grab;
        const g = smooth(k / 0.5);
        kk = smooth(Math.min(1, g / 0.6));
        lift = (d0.grabLift ?? 0.15) * Math.sin(Math.min(1, g / 0.5) * Math.PI * 0.5) * (1 - smooth((g - 0.6) / 0.4));
      } else {
        from = d0.grab;
        kk = smooth((k - 0.5) / 0.5);
      }
    }
    p.set((from[0] + (to[0] - from[0]) * kk) * sd, from[1] + (to[1] - from[1]) * kk + lift, from[2] + (to[2] - from[2]) * kk);
    pole.set(
      POLE.x * sd + (d0.pole[0] * sd - POLE.x * sd) * k,
      POLE.y + (d0.pole[1] - POLE.y) * k,
      POLE.z + (d0.pole[2] - POLE.z) * k,
    );
    this.liftShoulder(arm, p, pole);
    arm.upper.updateMatrixWorld(true);
    arm.upper.getWorldPosition(s);
    arm.fore.getWorldPosition(e);
    arm.hand.getWorldPosition(h);
    const la = s.distanceTo(e);
    const lb = e.distanceTo(h);
    const d = Math.min(Math.max(s.distanceTo(p), 0.02), (la + lb) * 0.995);
    const dir = a.subVectors(p, s).normalize();
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = b.copy(s).addScaledVector(dir, la * cosA).addScaledVector(pole, la * sinA);
    this.aim(arm.upper, s, e, elbow, 1);
    arm.fore.updateMatrixWorld(true);
    arm.fore.getWorldPosition(e);
    arm.hand.getWorldPosition(h);
    this.aim(arm.fore, e, h, p, 1);
    if (!arm.tip) return;
    // 손가락 방향: 키보드 위 방향에서 정한 방향으로
    arm.hand.updateMatrixWorld(true);
    arm.hand.getWorldPosition(h);
    arm.tip.getWorldPosition(e);
    const fg = d0.grab ? (d0.grabFinger ?? d0.finger) : d0.finger;
    const want = a.set(-0.15 * sd, -0.12, 1).normalize();
    b.set(fg[0] * sd, fg[1], fg[2]).normalize();
    // 집는 손짓은 물건 자리에서 이미 쥔 손 방향, 그 뒤로 정한 방향으로
    const fk = d0.grab ? Math.min(1, k / 0.5) : k;
    want.lerp(b, fk).normalize();
    if (d0.grab && k > 0.5) want.lerp(this.v.pole.set(d0.finger[0] * sd, d0.finger[1], d0.finger[2]).normalize(), smooth((k - 0.5) / 0.5)).normalize();
    want.add(h);
    this.aim(arm.hand, h, e, want, 1);
    // 손바닥 방향: 손가락 축을 중심으로 돌려 엄지가 정한 쪽을 향하게
    if (arm.thumb && k > 0.001) {
      arm.hand.updateMatrixWorld(true);
      arm.hand.getWorldPosition(h);
      arm.tip.getWorldPosition(e);
      const f = a.subVectors(e, h).normalize();
      arm.thumb.getWorldPosition(e);
      e.sub(h);
      e.addScaledVector(f, -e.dot(f));
      const th = d0.grab && k <= 0.5 ? (d0.grabThumb ?? d0.thumb) : d0.thumb;
      b.set(th[0] * sd, th[1], th[2]);
      b.addScaledVector(f, -b.dot(f));
      if (e.lengthSq() > 1e-8 && b.lengthSq() > 1e-8) {
        e.normalize().add(h);
        b.normalize().add(h);
        this.aim(arm.hand, h, e, b, d0.grab ? Math.min(1, k / 0.5) : k * k);
      }
    }
    if (d0.curl) this.curlFingers(sd, d0.curl, k);
  }

  /**
   * 팔꿈치를 옆·위로 벌릴수록 쇄골을 같이 들어 올린다. 쇄골이 그대로면 위팔만 돌아가 어깨 살이 접혀 보인다.
   * 손 자리 p 와 팔꿈치 방향 pole 로 팔꿈치가 어디쯤 올지 어림해서, 위팔이 아래로 처진 자세에서 멀어진 만큼 든다.
   */
  private liftShoulder(arm: Arm, p: T.Vector3, pole: T.Vector3): void {
    if (!arm.clav) return;
    const { s, e } = this.v;
    arm.upper.updateMatrixWorld(true);
    arm.upper.getWorldPosition(s);
    // 어림 팔꿈치: 어깨와 손 사이 가운데에서 pole 쪽으로 위팔 길이의 절반
    e.addVectors(s, p).multiplyScalar(0.5);
    const pl = pole.clone().normalize();
    e.addScaledVector(pl, 0.12);
    const up = e.sub(s).normalize();
    // 옆으로 벌린 정도(바깥쪽 성분)와 들어 올린 정도(위쪽 성분)
    const out = Math.max(0, up.x * arm.side);
    const rise = up.y + 0.85; // 바로 아래면 -1 → 거의 0
    const amt = Math.min(0.3, Math.max(0, out * 0.7 + rise * 0.36 - 0.16)); // 더 크면 어깨를 으쓱한 것처럼 보임
    if (amt <= 0.001) return;
    this.touch(arm.clav);
    // 장면 기준 앞 축(Z)으로 돌려 바깥 끝을 올린다: local' = 부모⁻¹ · 회전 · 부모 · local
    const rot = this.q1.setFromAxisAngle(this.axisZ, amt * arm.side);
    const parentW = new this.THREE.Quaternion();
    arm.clav.parent?.getWorldQuaternion(parentW);
    const boneW = parentW.clone().multiply(arm.clav.quaternion);
    arm.clav.quaternion.copy(parentW.invert().multiply(rot.multiply(boneW)));
    arm.clav.updateMatrixWorld(true);
    this.touchedAfter(arm.clav);
  }

  /** 손 흔들기 시작. side +1 = 왼손. len = 흔드는 시간(초, 들고 내리는 시간 빼고) */
  startWave(side: 1 | -1 = 1, len = 2.6): boolean {
    if (this.waving || this.posing) return false;
    this.wave = { side, e: 0, fallAt: WAVE_RISE + len };
    return true;
  }

  /** 흔들던 손을 바로 내려놓기 시작 */
  stopWave(): void {
    const wv = this.wave;
    if (wv.e >= 0 && wv.e < wv.fallAt) wv.fallAt = wv.e;
  }

  get waving(): boolean {
    return this.wave.e >= 0;
  }

  /** waveK(0~1): 키보드 자리에서 손 흔드는 자리로 옮긴 정도 */
  private solve(arm: Arm, weight: number, w: number, waveK = 0): void {
    const { s, e, h, p, a, b, pole } = this.v;
    const t = this.t;
    // 손가락 두드림: 손마다 다른 빠르기로, 가끔 쉬었다 친다 (불규칙). 쉴 때는 멈춤
    const burst = Math.sin(t * 0.9 + arm.phase) + 0.6 * Math.sin(t * 2.3 + arm.phase * 1.7);
    const tapping = burst > -0.3 ? 1 : 0;
    const tap = weight * tapping * Math.pow(Math.max(0, Math.sin(t * (11 + arm.side) + arm.phase)), 3);
    // 두드림이 올라가며 0.35 를 넘는 순간 = 키를 누름 (손이 키보드 위에 있을 때만)
    if (tap > 0.35 && arm.prevTap <= 0.35 && w > 0.9 && waveK < 0.05) this.onKey?.(arm.side, Math.min(1, weight));
    arm.prevTap = tap;
    // 키보드 위 손 자리 + 두드릴 때 살짝 들림 + 천천히 조금씩 옮겨 다님(칠 때만 크게)
    const drift = 0.3 + 0.7 * weight;
    p.set(
      HAND_TARGET.x * arm.side + Math.sin(t * 0.7 + arm.phase) * 0.012 * drift,
      HAND_TARGET.y + tap * 0.01,
      HAND_TARGET.z + Math.sin(t * 0.5 + arm.phase * 2) * 0.008 * drift,
    );
    pole.set(POLE.x * arm.side, POLE.y, POLE.z);
    // 손 흔들기: 손 자리·팔꿈치 방향을 흔드는 자세로 옮기고, 아래팔째 좌우로 살랑
    let swing = 0;
    if (waveK > 0) {
      const k = waveK;
      swing = Math.sin(Math.max(0, this.wave.e - WAVE_RISE * 0.6) * Math.PI * 2 * WAVE_HZ) * WAVE_SWING * k;
      p.x += (WAVE_TARGET.x * arm.side + Math.sin(swing) * 0.03 * arm.side - p.x) * k;
      p.y += (WAVE_TARGET.y - p.y) * k;
      p.z += (WAVE_TARGET.z - p.z) * k;
      pole.x += (WAVE_POLE.x * arm.side - pole.x) * k;
      pole.y += (WAVE_POLE.y - pole.y) * k;
      pole.z += (WAVE_POLE.z - pole.z) * k;
      this.liftShoulder(arm, p, pole);
    }

    arm.upper.updateMatrixWorld(true);
    arm.upper.getWorldPosition(s);
    arm.fore.getWorldPosition(e);
    arm.hand.getWorldPosition(h);
    const la = s.distanceTo(e);
    const lb = e.distanceTo(h);
    const d = Math.min(Math.max(s.distanceTo(p), 0.02), (la + lb) * 0.995);
    // 팔꿈치 자리: 어깨→손 방향에서 팔꿈치 쪽(아래·바깥)으로 굽힘 (코사인 법칙)
    const dir = a.subVectors(p, s).normalize();
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = b.copy(s).addScaledVector(dir, la * cosA).addScaledVector(pole, la * sinA);

    // 위팔: 지금 위팔 방향(어깨→팔꿈치)을 새 방향으로 돌린다
    this.aim(arm.upper, s, e, elbow, w);
    // 아래팔: 다시 읽고 팔꿈치→손을 목표로
    arm.fore.updateMatrixWorld(true);
    arm.fore.getWorldPosition(e);
    arm.hand.getWorldPosition(h);
    this.aim(arm.fore, e, h, p, w);
    // 손: 손가락이 앞쪽 살짝 아래를 향하게 (키보드 위)
    if (arm.tip) {
      arm.hand.updateMatrixWorld(true);
      arm.hand.getWorldPosition(h);
      arm.tip.getWorldPosition(e);
      const want = a.set(-0.15 * arm.side, -0.12, 1).normalize();
      if (waveK > 0) {
        // 손가락은 위로, 흔들 때마다 바깥·안쪽으로 기울어짐
        b.set(Math.sin(swing) * arm.side, Math.cos(swing), 0.12).normalize();
        want.lerp(b, waveK).normalize();
      }
      want.add(h);
      this.aim(arm.hand, h, e, want, w * (0.8 + 0.2 * waveK));
      // 손바닥을 화면 쪽으로: 손가락 축을 중심으로 돌려 엄지가 몸 안쪽을 향하게
      if (waveK > 0 && arm.thumb) {
        arm.hand.updateMatrixWorld(true);
        arm.hand.getWorldPosition(h);
        arm.tip.getWorldPosition(e);
        const f = a.subVectors(e, h).normalize();
        arm.thumb.getWorldPosition(e);
        e.sub(h);
        e.addScaledVector(f, -e.dot(f));
        b.set(-arm.side, 0, 0.25);
        b.addScaledVector(f, -b.dot(f));
        if (e.lengthSq() > 1e-8 && b.lengthSq() > 1e-8) {
          e.normalize().add(h);
          b.normalize().add(h);
          this.aim(arm.hand, h, e, b, waveK * waveK); // 손이 거의 올라간 뒤에 돌려 올라가는 중 손목이 꺾여 보이지 않게
        }
      }
    }
  }

  /** 뼈를 직접 바꾼 뒤 부른다 — 다음 프레임에 되돌릴 기준 */
  private touchedAfter(bone: T.Bone): void {
    const mem = this.rotMem.get(bone);
    if (mem && mem.frame === this.frame) mem.after.copy(bone.quaternion);
  }

  /** bone 을 돌려 (from→cur) 방향이 (from→target) 이 되게. w 만큼만 (0~1) */
  private aim(bone: T.Bone, from: T.Vector3, cur: T.Vector3, target: T.Vector3, w: number): void {
    const THREE = this.THREE;
    const v0 = new THREE.Vector3().subVectors(cur, from);
    const v1 = new THREE.Vector3().subVectors(target, from);
    if (v0.lengthSq() < 1e-10 || v1.lengthSq() < 1e-10) return;
    v0.normalize();
    v1.normalize();
    this.touch(bone);
    const rotW = this.q1.setFromUnitVectors(v0, v1); // 장면 기준 회전
    // 뼈 로컬 회전 = 부모월드⁻¹ · 회전 · 뼈월드
    const boneW = new THREE.Quaternion();
    bone.getWorldQuaternion(boneW);
    const parentW = new THREE.Quaternion();
    bone.parent?.getWorldQuaternion(parentW);
    const newW = this.q2.copy(rotW).multiply(boneW);
    const local = parentW.invert().multiply(newW);
    this.qRest.copy(bone.quaternion);
    bone.quaternion.copy(this.qRest).slerp(local, w);
    bone.updateMatrixWorld(true);
    this.touchedAfter(bone);
  }
}
