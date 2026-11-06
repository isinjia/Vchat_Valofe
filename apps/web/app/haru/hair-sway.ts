/**
 * 머리카락 흔들림 — 앞머리·옆머리 뼈 끝에 가상의 점을 달아 용수철로 따라가게 하고, 뼈를 그 점 쪽으로 돌린다.
 * 고개를 돌리거나 끄덕이면 머리카락 끝이 살짝 늦게 따라오고, 멈추면 몇 번 출렁이다 가라앉는다.
 *
 * 머리카락 뼈는 몸 애니메이션에 없어서 mixer 가 덮어쓰지 않으므로, 매 프레임 처음 자세로 되돌린 뒤 다시 돌린다.
 * 매 프레임: 얼굴 리그(rig.apply) → 키보드 자세 뒤, 렌더 직전에 update(dt) 를 부른다.
 */
import type * as T from "three";

type Three = typeof import("three");

/** 흔들 뼈와 세기. 하루 모델에서 머리카락 정점이 붙은 뼈만 */
const HAIR: Array<{ name: string; gain: number; len: number }> = [
  { name: "hairF_Bone01", gain: 0.35, len: 0.06 }, // 앞머리 (얼굴에 붙어 있어 약하게)
  { name: "hairF_bone02", gain: 0.35, len: 0.06 },
  { name: "hairF_bone03", gain: 0.35, len: 0.06 },
  { name: "hairS_Bone01", gain: 0.8, len: 0.07 }, // 옆머리 (뿌리)
  { name: "hairS_Bone04", gain: 0.6, len: 0.05 }, // 옆머리 (끝)
  { name: "hairS_Bone02", gain: 0.8, len: 0.07 },
  { name: "hairS_Bone03", gain: 0.6, len: 0.05 },
  { name: "hairB_Bone02", gain: 0.6, len: 0.05 }, // 뒷머리
];
const STIFF = 90; // 용수철 세기
const DAMP = 9; // 감쇠 (작을수록 오래 출렁임)
const MAX_ANGLE = 0.22; // 뼈가 돌아갈 수 있는 최대 각(라디안)

interface Strand {
  bone: T.Bone;
  rest: T.Quaternion;
  gain: number;
  len: number;
  tip: T.Vector3; // 가상의 끝점 (장면 기준)
  vel: T.Vector3;
  ready: boolean;
}

export class HairSway {
  private readonly THREE: Three;
  private readonly strands: Strand[] = [];
  private readonly v = { a: null as unknown as T.Vector3, b: null as unknown as T.Vector3, c: null as unknown as T.Vector3 };
  private readonly q = { a: null as unknown as T.Quaternion, b: null as unknown as T.Quaternion };
  /** 0 이면 끔 */
  strength = 1;

  constructor(THREE: Three, model: T.Object3D) {
    this.THREE = THREE;
    this.v.a = new THREE.Vector3();
    this.v.b = new THREE.Vector3();
    this.v.c = new THREE.Vector3();
    this.q.a = new THREE.Quaternion();
    this.q.b = new THREE.Quaternion();
    for (const h of HAIR) {
      const bone = model.getObjectByName(h.name) as T.Bone | undefined;
      if (!bone) continue;
      this.strands.push({ bone, rest: bone.quaternion.clone(), gain: h.gain, len: h.len, tip: new THREE.Vector3(), vel: new THREE.Vector3(), ready: false });
    }
  }

  update(dt: number): void {
    if (!this.strands.length) return;
    const { a, b, c } = this.v;
    const h = Math.min(dt, 1 / 30);
    for (const s of this.strands) {
      // 처음 자세로 되돌린 뒤, 지금 머리 움직임대로라면 끝점이 있어야 할 자리
      s.bone.quaternion.copy(s.rest);
      s.bone.updateMatrixWorld(true);
      const root = s.bone.getWorldPosition(a);
      const dirW = b.set(1, 0, 0).transformDirection(s.bone.matrixWorld); // Bip 뼈는 로컬 +X 가 뼈 방향
      const want = c.copy(root).addScaledVector(dirW, s.len);
      if (!s.ready) {
        s.tip.copy(want);
        s.vel.set(0, 0, 0);
        s.ready = true;
        continue;
      }
      // 용수철: 끝점이 있어야 할 자리로 끌려가고, 속도는 줄어든다 (작은 단계로 나눠 안정적으로)
      const steps = Math.max(1, Math.ceil(h / (1 / 120)));
      const sh = h / steps;
      for (let i = 0; i < steps; i++) {
        const ax = (want.x - s.tip.x) * STIFF - s.vel.x * DAMP;
        const ay = (want.y - s.tip.y) * STIFF - s.vel.y * DAMP;
        const az = (want.z - s.tip.z) * STIFF - s.vel.z * DAMP;
        s.vel.x += ax * sh;
        s.vel.y += ay * sh;
        s.vel.z += az * sh;
        s.tip.addScaledVector(s.vel, sh);
      }
      if (this.strength <= 0) continue;
      // 뼈를 지금 방향(want)에서 끝점 방향으로 gain 만큼 돌린다
      const from = b.subVectors(want, root).normalize();
      const to = c.subVectors(s.tip, root);
      if (to.lengthSq() < 1e-10) continue;
      to.normalize();
      const rot = this.q.a.setFromUnitVectors(from, to);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(rot.w)));
      const w = Math.min(1, MAX_ANGLE / Math.max(ang, 1e-6)) * s.gain * this.strength;
      rot.slerp(this.q.b.identity(), 1 - w);
      // 장면 기준 회전 → 뼈 로컬: local' = 부모⁻¹ · 회전 · 부모 · local
      const parentW = this.q.b;
      if (s.bone.parent) s.bone.parent.getWorldQuaternion(parentW);
      else parentW.identity();
      const boneW = parentW.clone().multiply(s.bone.quaternion);
      const newW = rot.multiply(boneW);
      s.bone.quaternion.copy(parentW.invert().multiply(newW));
      s.bone.updateMatrixWorld(true);
    }
  }
}
