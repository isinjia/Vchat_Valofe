/**
 * 라스트오리진 2D 일러스트 모델(부품을 잘라 뼈로 움직이는 방식) 웹 재생기.
 * scripts/lao2d 가 만든 public/lao2d/<id>.json 을 읽어, 뼈 자세 → 부품 꼭짓점(스킨은 CPU 스키닝)을 매 프레임 계산한다.
 *
 * 매 프레임: rig.resetPose() → rig.applyClip(...) (원본 애니메이션) → rig.rotate / show 같은 덧씌우기 → rig.update()
 * 좌표는 유니티 장면 기준(x 오른쪽, y 위). 그리는 순서는 유니티와 같게(정렬 레이어 → order → 먼 것부터).
 */
import type * as T from "three";

type Three = typeof import("three");

export interface Lao2DNode { n: string; p: number; on: number; t: number[]; q: number[]; s: number[] }
export interface Lao2DPart {
  node: number; kind: "skin" | "sprite" | "mesh"; on: number; layer: number; order: number; tex: string; color: number[];
  pos: number[]; uv: number[]; idx: number[]; si?: number[]; sw?: number[]; bones?: number[]; bind?: number[];
}
interface Track { t?: number[]; q?: number[]; s?: number[]; on?: number[] }
export interface Lao2DClip { len: number; loop: number; fps: number; frames: number; tracks: Record<string, Track> }
export interface Lao2DData {
  id: string; nodes: Lao2DNode[]; parts: Lao2DPart[]; clips: Record<string, Lao2DClip>;
  view: { cx: number; cy: number; half: number };
}

interface Spring {
  pts: Array<{ i: number; parent: number; drive: boolean; x: number; y: number; px: number; py: number; ready: boolean }>;
  damping: number; elasticity: number; stiffness: number; gravity: number;
}

interface PartState {
  part: Lao2DPart;
  mesh: T.Mesh;
  pos: Float32Array;
  bind: T.Matrix4[];
}

export class Lao2DRig {
  readonly group: T.Group;
  readonly data: Lao2DData;
  private readonly THREE: Three;
  /** 지금 자세 (로컬) */
  readonly t: Float32Array;
  readonly q: Float32Array;
  readonly s: Float32Array;
  readonly on: Uint8Array;
  readonly world: T.Matrix4[];
  private readonly parts: PartState[] = [];
  private readonly springs: Spring[] = [];
  private readonly byName = new Map<string, number>();
  private readonly m = { a: null as unknown as T.Matrix4, b: null as unknown as T.Matrix4 };
  private readonly v = { p: null as unknown as T.Vector3, q: null as unknown as T.Quaternion, s: null as unknown as T.Vector3, q2: null as unknown as T.Quaternion };

  constructor(THREE: Three, data: Lao2DData, textures: Record<string, T.Texture>) {
    this.THREE = THREE;
    this.data = data;
    const n = data.nodes.length;
    this.t = new Float32Array(n * 3);
    this.q = new Float32Array(n * 4);
    this.s = new Float32Array(n * 3);
    this.on = new Uint8Array(n);
    this.world = data.nodes.map(() => new THREE.Matrix4());
    data.nodes.forEach((nd, i) => {
      if (!this.byName.has(nd.n)) this.byName.set(nd.n, i);
    });
    this.m.a = new THREE.Matrix4();
    this.m.b = new THREE.Matrix4();
    this.v.p = new THREE.Vector3();
    this.v.q = new THREE.Quaternion();
    this.v.q2 = new THREE.Quaternion();
    this.v.s = new THREE.Vector3();
    this.resetPose();
    this.computeWorld();

    this.group = new THREE.Group();
    const mats = new Map<string, T.MeshBasicMaterial>();
    // 그리는 순서: 정렬 레이어 → order → 먼 것(z 큰 것)부터
    const zOf = (p: Lao2DPart) => this.v.p.setFromMatrixPosition(this.world[p.node]).z;
    const sorted = data.parts.map((p, i) => ({ p, i, z: zOf(p) })).sort((a, b) => a.p.layer - b.p.layer || a.p.order - b.p.order || b.z - a.z || a.i - b.i);
    sorted.forEach(({ p }, ri) => {
      const key = p.tex + "|" + p.color.join(",");
      let mat = mats.get(key);
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({
          map: textures[p.tex] ?? null,
          color: new THREE.Color(p.color[0], p.color[1], p.color[2]),
          transparent: true, opacity: p.color[3], depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        });
        mats.set(key, mat);
      }
      const nv = p.pos.length / 3;
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(nv * 3);
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(p.uv), 2));
      g.setIndex(p.idx);
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = ri;
      mesh.name = data.nodes[p.node].n;
      this.group.add(mesh);
      const bind = p.bind ? Array.from({ length: p.bind.length / 16 }, (_, k) => new THREE.Matrix4().fromArray(p.bind!, k * 16)) : [];
      this.parts.push({ part: p, mesh, pos, bind });
    });
    this.update();
  }

  /** 이름으로 뼈 번호 (같은 이름이면 처음 것) */
  node(name: string): number {
    return this.byName.get(name) ?? -1;
  }

  /** 기본 자세로 되돌림 */
  resetPose(): void {
    this.data.nodes.forEach((nd, i) => {
      this.t.set(nd.t, i * 3);
      this.q.set(nd.q, i * 4);
      this.s.set(nd.s, i * 3);
      this.on[i] = nd.on;
    });
  }

  /** 원본 클립을 time 초에서 w 만큼 섞어 입힌다 (켜짐은 w>0.5 일 때만 따름) */
  applyClip(name: string, time: number, w = 1): void {
    const c = this.data.clips[name];
    if (!c || w <= 0) return;
    let ft = time * c.fps;
    const last = c.frames - 1;
    ft = last <= 0 ? 0 : c.loop ? ((ft % last) + last) % last : Math.min(Math.max(ft, 0), last);
    const f0 = Math.floor(ft);
    const f1 = Math.min(f0 + 1, last);
    const k = ft - f0;
    const { q: qa, q2: qb } = this.v;
    for (const [key, tr] of Object.entries(c.tracks)) {
      const i = +key;
      if (tr.t) for (let a = 0; a < 3; a++) {
        const v = tr.t[f0 * 3 + a] + (tr.t[f1 * 3 + a] - tr.t[f0 * 3 + a]) * k;
        this.t[i * 3 + a] += (v - this.t[i * 3 + a]) * w;
      }
      if (tr.s) for (let a = 0; a < 3; a++) {
        const v = tr.s[f0 * 3 + a] + (tr.s[f1 * 3 + a] - tr.s[f0 * 3 + a]) * k;
        this.s[i * 3 + a] += (v - this.s[i * 3 + a]) * w;
      }
      if (tr.q) {
        qa.fromArray(tr.q, f0 * 4);
        qb.fromArray(tr.q, f1 * 4);
        qa.slerp(qb, k);
        qb.fromArray(this.q, i * 4);
        qb.slerp(qa, w);
        this.q[i * 4] = qb.x; this.q[i * 4 + 1] = qb.y; this.q[i * 4 + 2] = qb.z; this.q[i * 4 + 3] = qb.w;
      }
      if (tr.on && w > 0.5) this.on[i] = tr.on[Math.round(ft)] ?? tr.on[f0];
    }
  }

  /** 뼈를 화면 기준 z 축으로 angle(라디안, + 는 시계 반대)만큼 더 돌린다 (로컬 회전에 덧붙임) */
  rotate(i: number, angle: number): void {
    if (i < 0 || !angle) return;
    const { q } = this.v;
    q.fromArray(this.q, i * 4);
    q.multiply(this.v.q2.set(0, 0, Math.sin(angle / 2), Math.cos(angle / 2)));
    this.q[i * 4] = q.x; this.q[i * 4 + 1] = q.y; this.q[i * 4 + 2] = q.z; this.q[i * 4 + 3] = q.w;
  }

  /** 뼈를 로컬 좌표로 옮긴다 */
  move(i: number, dx: number, dy: number): void {
    if (i < 0) return;
    this.t[i * 3] += dx;
    this.t[i * 3 + 1] += dy;
  }

  /** 뼈 크기를 곱한다 */
  scale(i: number, sx: number, sy: number): void {
    if (i < 0) return;
    this.s[i * 3] *= sx;
    this.s[i * 3 + 1] *= sy;
  }

  show(i: number, on: boolean): void {
    if (i >= 0) this.on[i] = on ? 1 : 0;
  }

  private computeWorld(): void {
    const { p, q, s } = this.v;
    const nodes = this.data.nodes;
    for (let i = 0; i < nodes.length; i++) {
      p.fromArray(this.t, i * 3);
      q.fromArray(this.q, i * 4);
      s.fromArray(this.s, i * 3);
      const w = this.world[i].compose(p, q, s);
      const par = nodes[i].p;
      if (par >= 0) w.premultiply(this.world[par]);
    }
  }

  /**
   * 원본의 흔들림 뼈(게임은 DynamicBone 물리)를 2D 용수철로 흉내 낸다. root 아래 뼈마다 가상 점을 두고,
   * 애니메이션 자리로 끌려가되 늦게 따라오게 한 뒤 부모 뼈를 그 점 쪽으로 돌린다.
   */
  addSpring(root: string, opt: { damping: number; elasticity: number; stiffness: number; gravity?: number }): void {
    const r = this.node(root);
    if (r < 0) return;
    const nodes = this.data.nodes;
    const inTree = (i: number) => { for (let k = nodes[i].p; k >= 0; k = nodes[k].p) if (k === r) return true; return false; };
    const pts: Spring["pts"] = [];
    nodes.forEach((n, i) => {
      if (!inTree(i)) return;
      // 부모가 첫째 자식일 때만 부모를 돌린다 (갈래가 여러 개면 첫 갈래 기준)
      const sib = nodes.findIndex((m) => m.p === n.p);
      pts.push({ i, parent: n.p, drive: sib === i, x: 0, y: 0, px: 0, py: 0, ready: false });
    });
    this.springs.push({ pts, ...opt, gravity: opt.gravity ?? 0 });
  }

  /** 흔들림 계산 (applyClip 등 자세를 정한 뒤, update 전에) */
  simulate(dt: number): void {
    if (!this.springs.length) return;
    this.computeWorld();
    const steps = Math.max(1, Math.min(4, Math.round(dt * 60)));
    const { p: va, s: vb } = this.v;
    for (const sp of this.springs) {
      // 애니메이션이 정한 자리 (위에서부터 차례로 — 부모를 돌리면 자식 자리도 바뀜)
      for (const pt of sp.pts) {
        va.setFromMatrixPosition(this.world[pt.i]);
        if (!pt.ready) { pt.x = pt.px = va.x; pt.y = pt.py = va.y; pt.ready = true; continue; }
        const par = vb.setFromMatrixPosition(this.world[pt.parent]);
        const rest = Math.hypot(va.x - par.x, va.y - par.y);
        for (let s = 0; s < steps; s++) {
          const vx = (pt.x - pt.px) * (1 - sp.damping);
          const vy = (pt.y - pt.py) * (1 - sp.damping) - sp.gravity;
          pt.px = pt.x; pt.py = pt.y;
          pt.x += vx + (va.x - pt.x) * sp.elasticity;
          pt.y += vy + (va.y - pt.y) * sp.elasticity;
          // 애니메이션 자리에서 너무 멀어지지 않게 (stiffness 클수록 가깝게)
          const lim = rest * (1 - sp.stiffness) * 0.6;
          const dx = pt.x - va.x, dy = pt.y - va.y, d = Math.hypot(dx, dy);
          if (d > lim && d > 0) { pt.x = va.x + dx / d * lim; pt.y = va.y + dy / d * lim; }
          // 부모와의 길이 유지
          const ex = pt.x - par.x, ey = pt.y - par.y, e = Math.hypot(ex, ey);
          if (e > 0 && rest > 0) { pt.x = par.x + ex / e * rest; pt.y = par.y + ey / e * rest; }
        }
        if (!pt.drive || rest <= 1e-6) continue;
        // 부모 뼈를 (애니메이션 방향 → 점 방향) 만큼 돌린다
        const a0 = Math.atan2(va.y - par.y, va.x - par.x);
        const a1 = Math.atan2(pt.y - par.y, pt.x - par.x);
        let da = a1 - a0;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        // 화면 기준 회전을 부모의 로컬로: 부모 월드가 뒤집혀 있으면(크기 음수) 반대로
        const pw = this.world[pt.parent].elements;
        const flip = pw[0] * pw[5] - pw[1] * pw[4] < 0 ? -1 : 1;
        this.rotate(pt.parent, da * flip);
        this.computeWorld();
      }
    }
  }

  /** 자세 → 부품 꼭짓점 */
  update(): void {
    this.computeWorld();
    const nodes = this.data.nodes;
    const vis = new Uint8Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) vis[i] = this.on[i] && (nodes[i].p < 0 || vis[nodes[i].p]) ? 1 : 0;
    const { a } = this.m;
    for (const ps of this.parts) {
      const p = ps.part;
      const visible = !!vis[p.node] && !!p.on;
      ps.mesh.visible = visible;
      if (!visible) continue;
      const src = p.pos;
      const out = ps.pos;
      const nv = src.length / 3;
      if (p.kind === "skin" && p.si && p.sw && p.bones) {
        // 뼈마다 (뼈 월드 × bindpose) 를 미리
        // 원본에 bindpose 가 뼈보다 적은 부품이 있다(가방·치마) — 없는 쪽은 단위 행렬, 그 뼈에 붙은 정점은 거의 없음
        const mats = p.bones.map((b, k) => {
          a.copy(b >= 0 ? this.world[b] : this.m.b.identity());
          if (ps.bind[k]) a.multiply(ps.bind[k]);
          return a.clone();
        });
        for (let v = 0; v < nv; v++) {
          const x = src[v * 3], y = src[v * 3 + 1], z = src[v * 3 + 2];
          let ox = 0, oy = 0, oz = 0;
          for (let k = 0; k < 4; k++) {
            const wgt = p.sw[v * 4 + k];
            if (wgt <= 0) continue;
            const mk = mats[p.si[v * 4 + k]];
            if (!mk) continue;
            const e = mk.elements;
            ox += wgt * (e[0] * x + e[4] * y + e[8] * z + e[12]);
            oy += wgt * (e[1] * x + e[5] * y + e[9] * z + e[13]);
            oz += wgt * (e[2] * x + e[6] * y + e[10] * z + e[14]);
          }
          out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = 0;
          void oz;
        }
      } else {
        const e = this.world[p.node].elements;
        for (let v = 0; v < nv; v++) {
          const x = src[v * 3], y = src[v * 3 + 1], z = src[v * 3 + 2];
          out[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
          out[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          out[v * 3 + 2] = 0;
        }
      }
      (ps.mesh.geometry.getAttribute("position") as T.BufferAttribute).needsUpdate = true;
    }
  }
}

/** JSON 과 그림을 불러 재생기를 만든다 */
export async function loadLao2D(THREE: Three, base: string, id: string): Promise<Lao2DRig> {
  const data = (await (await fetch(`${base}/${id}.json`)).json()) as Lao2DData;
  const loader = new THREE.TextureLoader();
  const textures: Record<string, T.Texture> = {};
  for (const name of new Set(data.parts.map((p) => p.tex))) {
    const tex = await loader.loadAsync(`${base}/${name}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    textures[name] = tex;
  }
  return new Lao2DRig(THREE, data, textures);
}
