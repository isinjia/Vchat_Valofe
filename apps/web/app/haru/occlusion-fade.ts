/**
 * 가림 반투명 — 카메라와 하루 사이를 가리는 방 소품(노트북 화면, 스탠드 등)을 반투명하게 만든다.
 *
 * 카메라에서 하루 몸 여러 곳(머리·목·가슴·팔·손)으로 광선을 쏴서, 하루보다 앞에서 맞는 소품을
 * 찾는다. 맞은 소품 묶음('room:' 이름의 그룹)의 셀 셰이더 uFade 를 서서히 낮추고, 안 가리면 되돌린다.
 * 광선 검사는 몇 프레임에 한 번만 한다(무거움). 투명도 변화는 매 프레임 부드럽게.
 */
import type * as T from "three";

type Three = typeof import("three");

/** 가릴 때 남길 불투명도 */
const FADED = 0.3;
/** 광선 검사 간격(초) */
const CHECK_EVERY = 0.12;
/** 하루 몸에서 광선을 쏠 뼈 (머리는 위쪽 조금 더) */
const PROBE_BONES: Array<[string, number]> = [
  ["Bip01_Head", 0.06],
  ["Bip01_Head", 0],
  ["Bip01_Neck", 0],
  ["Bip01_Spine2", 0],
  ["Bip01_Spine1", 0],
  ["Bip01_L_Forearm", 0],
  ["Bip01_R_Forearm", 0],
  ["Bip01_L_Hand", 0],
  ["Bip01_R_Hand", 0],
];

interface FadeMat {
  m: T.ShaderMaterial;
  transparent: boolean;
  depthWrite: boolean;
}
interface Group {
  root: T.Object3D;
  meshes: T.Object3D[];
  mats: FadeMat[];
  fade: number;
  want: number;
}

export class OcclusionFade {
  private readonly ray: T.Raycaster;
  private readonly groups: Group[] = [];
  private readonly byMesh = new Map<T.Object3D, Group>();
  private readonly targets: Array<{ bone: T.Object3D; up: number }> = [];
  private readonly meshes: T.Object3D[] = [];
  private readonly p: T.Vector3;
  private readonly dir: T.Vector3;
  private readonly cam: T.Vector3;
  private since = CHECK_EVERY;

  constructor(THREE: Three, scene: T.Scene, model: T.Object3D) {
    this.ray = new THREE.Raycaster();
    this.p = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.cam = new THREE.Vector3();
    for (const child of scene.children) {
      if (!child.name.startsWith("room:")) continue;
      const g: Group = { root: child, meshes: [], mats: [], fade: 1, want: 1 };
      child.traverse((o) => {
        const mesh = o as T.Mesh;
        if (!mesh.isMesh) return;
        const ms = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as T.ShaderMaterial[];
        for (const m of ms) if (m.uniforms?.uFade) g.mats.push({ m, transparent: m.transparent, depthWrite: m.depthWrite });
        // 외곽선 껍질(뒷면, renderOrder -1)은 광선 검사에서 뺀다 — 실제 면보다 두꺼움
        if (mesh.renderOrder === -1) return;
        g.meshes.push(mesh);
        this.byMesh.set(mesh, g);
        this.meshes.push(mesh);
      });
      if (g.mats.length) this.groups.push(g);
    }
    for (const [name, up] of PROBE_BONES) {
      const bone = model.getObjectByName(name);
      if (bone) this.targets.push({ bone, up });
    }
  }

  update(dt: number, camera: T.Camera): void {
    this.since += dt;
    if (this.since >= CHECK_EVERY && this.targets.length) {
      this.since = 0;
      for (const g of this.groups) g.want = 1;
      camera.getWorldPosition(this.cam);
      for (const t of this.targets) {
        t.bone.getWorldPosition(this.p);
        this.p.y += t.up;
        this.dir.subVectors(this.p, this.cam);
        const far = this.dir.length() - 0.03; // 하루 몸 바로 앞까지만
        if (far <= 0) continue;
        this.ray.set(this.cam, this.dir.normalize());
        this.ray.far = far;
        const hit = this.ray.intersectObjects(this.meshes, false);
        for (const h of hit) {
          const g = this.byMesh.get(h.object);
          if (g) g.want = FADED;
        }
      }
    }
    const k = 1 - Math.exp(-dt * 8);
    for (const g of this.groups) {
      if (Math.abs(g.want - g.fade) < 1e-3 && g.fade === g.want) continue;
      g.fade += (g.want - g.fade) * k;
      if (Math.abs(g.want - g.fade) < 0.005) g.fade = g.want;
      const faded = g.fade < 0.999;
      for (const f of g.mats) {
        f.m.uniforms.uFade.value = g.fade;
        f.m.transparent = faded || f.transparent;
        f.m.depthWrite = faded ? false : f.depthWrite;
      }
    }
  }
}
