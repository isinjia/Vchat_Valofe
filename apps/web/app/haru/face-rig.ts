/**
 * 하루 얼굴·상체 리그 — 게임 뼈대(Bip01 Xtra##_*, 척추, 쇄골)를 직접 움직여 눈 깜빡임·시선·입·고개와
 * 앉은 채 하는 작은 상체 몸짓(기울이기·어깨 들썩임)을 만든다.
 * 모프 타깃이 없는 모델이라 뼈 회전/이동만 쓴다.
 *
 * 사용 순서(매 프레임): beforeMixer() → mixer.update(dt) → model.updateMatrixWorld(true) → apply(params)
 *  - beforeMixer 는 지난 프레임에 덧씌운 값을 되돌려서 애니메이션이 안 건드리는 뼈가 누적되지 않게 한다.
 *  - apply 는 애니메이션 결과 위에 "모델 공간 축" 기준으로 회전/이동을 덧씌운다(뼈마다 제각각인 로컬 축을 신경 쓰지 않아도 됨).
 *
 * 모델 공간: +X 캐릭터 왼쪽, +Y 위, +Z 얼굴 정면. 뼈 단위는 cm.
 */
import type * as T from "three";

type Three = typeof import("three");

export interface FaceParams {
  /** 0 뜸 ~ 1 감음 (음수면 더 크게 뜸) */
  blinkL: number;
  blinkR: number;
  /** 0 다묾 ~ 1 크게 벌림 */
  jaw: number;
  /** -1 입꼬리 내림 ~ 1 미소 */
  smile: number;
  /** 0 ~ 1 입 오므림(우) */
  pucker: number;
  /** 말할 때 입 폭: + 는 옆으로 넓게(이·에), - 는 동그랗게 모음(오·우). 대략 -1 ~ 1 */
  mouthWidth: number;
  /** 눈썹: + 는 올림(놀람·물음), - 는 내림(찡그림). 대략 -1 ~ 1 */
  brow: number;
  /** -1 (캐릭터 기준 오른쪽) ~ 1 (왼쪽) */
  gazeX: number;
  /** -1 아래 ~ 1 위 */
  gazeY: number;
  /** 라디안. yaw + 는 캐릭터 왼쪽으로 돌림, pitch + 는 위를 봄, roll + 는 왼쪽 어깨 쪽으로 기울임 */
  headYaw: number;
  headPitch: number;
  headRoll: number;
  /** 상체(척추) 기울기, 라디안. pitch + 는 앞으로 숙임, roll + 는 왼쪽으로 기울임 */
  bodyPitch: number;
  bodyRoll: number;
  /** 상체 비틀기, 라디안. + 는 캐릭터 왼쪽으로 돌림 */
  bodyYaw: number;
  /** 어깨: + 는 으쓱(들어 올림), - 는 처짐. 대략 -1 ~ 1 */
  shoulders: number;
}

export const NEUTRAL_FACE: FaceParams = {
  blinkL: 0, blinkR: 0, jaw: 0, smile: 0, pucker: 0, mouthWidth: 0, brow: 0, gazeX: 0, gazeY: 0, headYaw: 0, headPitch: 0, headRoll: 0,
  bodyPitch: 0, bodyRoll: 0, bodyYaw: 0, shoulders: 0,
};

/** 뼈별 최대 변위 (라디안 / cm). 브라우저에서 보정한 값 */
export const FACE_TUNING = {
  lidUpClose: 0.62, // 윗눈꺼풀이 감길 때 회전량
  lidDownClose: -0.22, // 아랫눈꺼풀이 올라오는 회전량 (반대 방향)
  gazeYaw: 0.28,
  gazePitch: 0.16,
  jawOpen: 0.32,
  upperLift: 0.55, // 입을 벌릴 때 윗입술·윗니가 올라가는 양(cm, 벌림 1 기준) — 없으면 윗입술이 고정되고 아래턱만 움직여 보임
  mouthWidthAmt: 0.42, // 입 폭 1 일 때 입꼬리가 옆으로 움직이는 양(cm). 음수면 안으로 모임
  cornerDrop: 0.32, // 입을 벌릴 때 입꼬리가 턱을 따라 내려가는 양(cm, 벌림 1 기준) — 없으면 늘 웃는 'D' 입이 됨
  smileUp: 0.45, // 입꼬리 위로(cm) — 크면 입이 옆으로 찢어진 듯 과하게 웃음
  smileOut: 0.34, // 입꼬리 바깥으로(cm)
  frownDown: 0.22, // 처진 입꼬리(cm). 크면 어색하게 눈에 띔
  puckerIn: 0.45,
  headShare: 0.65, // 머리:목 회전 분배 (머리 비중)
  shoulderUp: 0.22, // 어깨 으쓱 1 일 때 쇄골 회전(라디안)
  browUp: 0.2, // 눈 크게 뜨기 1 일 때 윗속눈썹 선(Eyeline 뼈)이 올라가는 양(cm). 하루 눈썹은 앞머리에 가려 이 선으로 대신함
};

interface Saved { p: T.Vector3; q: T.Quaternion }

function norm(n: string): string {
  return n.replace(/[\s_]/g, "").toLowerCase();
}

export class FaceRig {
  private readonly THREE: Three;
  private readonly model: T.Object3D;
  private readonly bones = new Map<string, T.Bone>();
  private readonly saved = new Map<T.Bone, Saved>();
  private readonly tmpQ: T.Quaternion;
  private readonly tmpQ2: T.Quaternion;
  private readonly tmpV: T.Vector3;
  private readonly modelQ: T.Quaternion;
  readonly ok: boolean;

  constructor(THREE: Three, model: T.Object3D) {
    this.THREE = THREE;
    this.model = model;
    this.tmpQ = new THREE.Quaternion();
    this.tmpQ2 = new THREE.Quaternion();
    this.tmpV = new THREE.Vector3();
    this.modelQ = new THREE.Quaternion();
    model.traverse((o) => {
      const b = o as T.Bone;
      if (b.isBone && /xtra|bip01[\s_]?(head|neck|spine1|spine2|l[\s_]?clavicle|r[\s_]?clavicle)$/i.test(b.name)) {
        // GLTFLoader 는 이름의 공백을 '_' 로 바꾸므로 공백·밑줄을 지우고 소문자로 맞춰 찾는다
        this.bones.set(norm(b.name), b);
      }
    });
    this.ok = !!this.bone("Bip01Xtra07_jaw") && !!this.bone("Bip01Head");
    if (!this.ok) console.warn("[하루 얼굴 리그] 얼굴 뼈를 찾지 못함:", [...this.bones.keys()]);
  }

  private bone(n: string): T.Bone | undefined {
    return this.bones.get(norm(n));
  }

  /** 지난 프레임의 덧씌움을 되돌린다 (mixer.update 전에 호출) */
  beforeMixer(): void {
    for (const [b, s] of this.saved) {
      b.position.copy(s.p);
      b.quaternion.copy(s.q);
    }
  }

  private remember(b: T.Bone): void {
    const s = this.saved.get(b);
    if (s) {
      s.p.copy(b.position);
      s.q.copy(b.quaternion);
    } else {
      this.saved.set(b, { p: b.position.clone(), q: b.quaternion.clone() });
    }
  }

  /** 뼈를 '모델 공간' 축 기준으로 회전 (축은 모델 좌표계, 각도 라디안) */
  private rotModel(b: T.Bone, ax: number, ay: number, az: number, angle: number): void {
    if (Math.abs(angle) < 1e-5) return;
    // 뼈의 모델 기준 회전 = inv(modelWorldQ) * boneWorldQ
    b.getWorldQuaternion(this.tmpQ);
    this.tmpQ.premultiply(this.tmpQ2.copy(this.modelQ).invert());
    // 모델 축 → 뼈 로컬 축
    this.tmpV.set(ax, ay, az).applyQuaternion(this.tmpQ.invert()).normalize();
    this.tmpQ2.setFromAxisAngle(this.tmpV, angle);
    b.quaternion.multiply(this.tmpQ2);
    b.updateMatrixWorld(true);
  }

  /** 뼈를 '모델 공간' 벡터(cm)만큼 이동 */
  private moveModel(b: T.Bone, dx: number, dy: number, dz: number): void {
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-5) return;
    const parent = b.parent ?? this.model;
    parent.getWorldQuaternion(this.tmpQ);
    this.tmpQ.premultiply(this.tmpQ2.copy(this.modelQ).invert());
    this.tmpV.set(dx, dy, dz).applyQuaternion(this.tmpQ.invert());
    b.position.add(this.tmpV);
    b.updateMatrixWorld(true);
  }

  /** 애니메이션 결과 위에 표정을 덧씌운다 (model.updateMatrixWorld(true) 뒤에 호출) */
  apply(p: FaceParams): void {
    if (!this.ok) return;
    const K = FACE_TUNING;
    this.model.getWorldQuaternion(this.modelQ);
    for (const b of this.bones.values()) this.remember(b);

    // 상체: 척추 두 마디에 나눠 기울이고, 쇄골로 어깨를 들썩인다 (부모 뼈부터)
    for (const [n, share] of [["Bip01Spine1", 0.45], ["Bip01Spine2", 0.55]] as const) {
      const sb = this.bone(n);
      if (!sb) continue;
      this.rotModel(sb, 1, 0, 0, p.bodyPitch * share);
      this.rotModel(sb, 0, 0, 1, p.bodyRoll * share);
      this.rotModel(sb, 0, 1, 0, p.bodyYaw * share);
    }
    const lc = this.bone("Bip01LClavicle");
    const rc = this.bone("Bip01RClavicle");
    if (lc) this.rotModel(lc, 0, 0, 1, p.shoulders * K.shoulderUp);
    if (rc) this.rotModel(rc, 0, 0, 1, -p.shoulders * K.shoulderUp);

    // 고개: 목과 머리에 나눠 준다
    const head = this.bone("Bip01Head");
    const neck = this.bone("Bip01Neck");
    const hs = K.headShare;
    if (neck) {
      this.rotModel(neck, 0, 1, 0, p.headYaw * (1 - hs));
      this.rotModel(neck, 1, 0, 0, -p.headPitch * (1 - hs));
      this.rotModel(neck, 0, 0, 1, p.headRoll * (1 - hs));
    }
    if (head) {
      this.rotModel(head, 0, 1, 0, p.headYaw * hs);
      this.rotModel(head, 1, 0, 0, -p.headPitch * hs);
      this.rotModel(head, 0, 0, 1, p.headRoll * hs);
    }

    // 눈꺼풀 (눈 중심이 피벗, 좌우 축으로 회전)
    const lids: Array<[string, string, number]> = [
      ["Bip01Xtra01_LEye_Up", "Bip01Xtra02_LEye_Down", p.blinkL],
      ["Bip01Xtra03_REye_Up", "Bip01Xtra04_REye_Down", p.blinkR],
    ];
    for (const [upN, downN, v] of lids) {
      const up = this.bone(upN);
      const down = this.bone(downN);
      if (up) this.rotModel(up, 1, 0, 0, v * K.lidUpClose);
      if (down) this.rotModel(down, 1, 0, 0, Math.max(0, v) * K.lidDownClose);
    }

    // 눈썹 (Xtra08/09 Eyeline 뼈 = 눈 위 눈썹 선)
    if (Math.abs(p.brow) > 1e-4) {
      for (const n of ["Bip01Xtra08_LEyeline01", "Bip01Xtra08_LEyeline02", "Bip01Xtra09_REyeline01", "Bip01Xtra09_REyeline02"]) {
        const b = this.bone(n);
        if (b) this.moveModel(b, 0, p.brow * K.browUp, 0);
      }
    }

    // 시선
    for (const n of ["Bip01Xtra05_LEye", "Bip01Xtra06_REye"]) {
      const e = this.bone(n);
      if (!e) continue;
      this.rotModel(e, 0, 1, 0, p.gazeX * K.gazeYaw);
      this.rotModel(e, 1, 0, 0, -p.gazeY * K.gazePitch);
    }

    // 턱
    const jaw = this.bone("Bip01Xtra07_jaw");
    if (jaw) this.rotModel(jaw, 1, 0, 0, Math.max(0, p.jaw) * K.jawOpen);

    // 입꼬리: 미소면 위·바깥, 찡그림이면 아래, 오므리면 안쪽
    const s = p.smile;
    const open = Math.max(0, p.jaw);
    // 감정 입꼬리는 입을 벌리는 순간엔 약하게, 음절 사이·말 멈출 때 다시 드러나게 한다
    // (말하는 내내 모든 음절에 똑같이 덮으면 윗입술·입꼬리가 감정 모양으로 굳어 보임)
    // 처진 입꼬리(슬픔·화남)는 벌린 입에서 거의 빼고(겹치면 둥근 지붕 입), 미소는 30% 만 남긴다
    const frownKeep = 1 - Math.min(1, open / 0.25);
    const smileKeep = 1 - 0.4 * Math.min(1, open / 0.3);
    const upY = s > 0 ? s * K.smileUp * smileKeep : s * K.frownDown * frownKeep;
    const outX = (s > 0 ? s * K.smileOut * smileKeep : 0) - p.pucker * K.puckerIn;
    // 말하는 입 모양: 폭(넓게 ↔ 동그랗게)과, 벌린 만큼 입꼬리가 턱을 따라 내려감
    const wide = p.mouthWidth * K.mouthWidthAmt;
    const drop = -open * K.cornerDrop;
    const l = this.bone("Bip01Xtra10_lip_left");
    const r = this.bone("Bip01Xtra11_lip_right");
    if (l) this.moveModel(l, outX + wide, upY + drop, 0);
    if (r) this.moveModel(r, -outX - wide, upY + drop, 0);
    const ul = this.bone("Bip01Xtra18_lip_UL");
    const ur = this.bone("Bip01Xtra19_lip_UR");
    const dl = this.bone("Bip01Xtra14_lip_DL");
    const dr = this.bone("Bip01Xtra15_lip_DR");
    if (ul) this.moveModel(ul, outX * 0.4 + wide * 0.6, upY * 0.4 + drop * 0.3, 0);
    if (ur) this.moveModel(ur, -outX * 0.4 - wide * 0.6, upY * 0.4 + drop * 0.3, 0);
    if (dl) this.moveModel(dl, outX * 0.4 + wide * 0.7, upY * 0.3, 0);
    if (dr) this.moveModel(dr, -outX * 0.4 - wide * 0.7, upY * 0.3, 0);
    // 오므릴 때 입술이 앞으로 살짝
    const lu = this.bone("Bip01Xtra12_lip_up");
    const ld = this.bone("Bip01Xtra13_lip_down");
    if (p.pucker > 0) {
      if (lu) this.moveModel(lu, 0, 0, p.pucker * 0.25);
      if (ld) this.moveModel(ld, 0, 0, p.pucker * 0.25);
    }
    // 벌린 만큼 윗입술(가운데 + 자식인 양쪽)과 윗니도 살짝 올라간다 → 위아래가 함께 벌어짐
    const lift = open * K.upperLift;
    if (lift > 1e-4) {
      if (lu) this.moveModel(lu, 0, lift, 0);
      const tu = this.bone("Bip01Xtra16_TeethUp");
      if (tu) this.moveModel(tu, 0, lift * 0.4, 0);
    }
  }
}

export function lerpFace(a: FaceParams, b: FaceParams, t: number): FaceParams {
  const o = { ...a };
  for (const k of Object.keys(o) as Array<keyof FaceParams>) o[k] = a[k] + (b[k] - a[k]) * t;
  return o;
}
