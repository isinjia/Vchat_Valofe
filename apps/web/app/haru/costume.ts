/**
 * 하루 꾸미기 — 코스튬(한 벌)과 장식(헤어·모자·인형탈·머리 장식·귀걸이·눈/입/얼굴 장식·얼굴·등·허리 장식)을
 * 종류마다 하나씩 입히고, 피부·눈·머리카락 색을 바꾼다.
 *  - scripts/haru-costume-export.py 가 만든 GLB 는 하루와 같은 뼈대로 내보냈으므로 뼈 이름으로 짝을 맞춘다.
 *    부품에만 있는 뼈(치마·머리카락·장식 등)는 하루의 부모 뼈 밑에 그대로 옮겨 붙인다 (몸을 따라 움직임).
 *  - 기본 부품은 통째로 가린다: 상의 → 몸, 하의 → 하의, 신발 → 발, 장갑 → 손 (코스튬이 그 부위 피부까지 갖고 있음).
 *    머리카락이 든 장식(헤어·대부분의 모자·인형탈)은 기본 머리를, 얼굴이 든 장식(얼굴·일부 인형탈)은 기본 얼굴을 가린다.
 */
import type * as T from "three";

type Three = typeof import("three");

export interface CostumeInfo {
  file: string;
  name: string;
  icon: string | null;
  slots: string[];
}
export interface ItemInfo {
  id: string;
  name: string;
  icon: string | null;
  file: string;
}

/** 꾸미기 종류 (outfit = 코스튬 한 벌) */
export const LOOK_SLOTS = ["outfit", "hair", "hat", "mask", "hairAcc", "ear", "eye", "mouth", "faceAcc", "face", "back", "tail"] as const;
export type LookSlot = (typeof LOOK_SLOTS)[number];

export interface Look {
  items: Partial<Record<LookSlot, string>>;
  skin: string;
  eyeColor: string;
  hairColor: string;
}
export const EMPTY_LOOK: Look = { items: {}, skin: "base", eyeColor: "base", hairColor: "base" };

/** 피부색: 원래 색에 곱함 */
export const SKIN_COLORS: Record<string, [string, [number, number, number]]> = {
  base: ["기본", [1, 1, 1]],
  fair: ["하얗게", [1.05, 1.03, 1.06]],
  pink: ["발그레", [1.0, 0.92, 0.92]],
  tan: ["구릿빛", [0.86, 0.72, 0.62]],
  brown: ["갈색", [0.7, 0.54, 0.44]],
};
/** 눈·머리카락 색: 밝기를 살려 이 색으로 물들임 */
export const EYE_COLORS: Record<string, [string, [number, number, number] | null]> = {
  base: ["기본", null],
  blue: ["파랑", [0.35, 0.6, 1.0]],
  green: ["초록", [0.4, 0.85, 0.45]],
  red: ["빨강", [1.0, 0.3, 0.3]],
  purple: ["보라", [0.7, 0.45, 1.0]],
  gold: ["금색", [1.0, 0.78, 0.3]],
  gray: ["회색", [0.7, 0.72, 0.78]],
};
export const HAIR_COLORS: Record<string, [string, [number, number, number] | null]> = {
  base: ["기본", null],
  blond: ["금발", [1.0, 0.86, 0.55]],
  brown: ["갈색", [0.62, 0.42, 0.28]],
  black: ["검정", [0.28, 0.25, 0.3]],
  silver: ["은발", [0.92, 0.92, 0.98]],
  pink: ["분홍", [1.0, 0.62, 0.78]],
  red: ["빨강", [0.92, 0.32, 0.28]],
  blue: ["파랑", [0.5, 0.66, 1.0]],
  purple: ["보라", [0.72, 0.52, 1.0]],
};

const BASE = "/haru/costume/";
/** 머리 쪽 장식의 붙이는 자리 (게임의 얼굴 위 장식 자리 뼈) */
const ORPHAN_HEAD = "FaceUpperAcc_Bone01";

/** 코스튬 부품 종류 → 가릴 기본 부품 (재질 이름) */
const OUTFIT_HIDE: Record<string, RegExp[]> = {
  top: [/^몸:/],
  suit: [/^몸:/, /^하의:/],
  bottom: [/^하의:/],
  suitLower: [/^하의:/],
  shoes: [/^발:/],
  gloves: [/^손:/],
};
// 머리카락 재질 (머리 장식 MT_HAIRACC·모자 MT_HAIRCAP 은 아님). 대소문자 그대로 비교해야 MT_HAIRACC 가 걸리지 않음
const HAS_HAIR = /:(MT_HAIR(?!ACC|_ACC|CAP)|MT_HIAR|MT_MASK_HAIR|MT_Hair_\d+)/;
const HAS_FACE = /:(MT_FACE|MT_EYE)/;
const SKIN_MAT = /:(MT_BODY|MT_FACE|MT_HAND)$/;
const EYE_MAT = /:MT_EYE/;
const HAIR_MAT = HAS_HAIR;

interface Worn {
  objs: T.Object3D[];
  bones: T.Object3D[];
  /** 이 장식이 기본 머리·얼굴을 가리는지 */
  hair: boolean;
  face: boolean;
  outfitHide: RegExp[];
}

export class CostumeWardrobe {
  private outfits: Record<string, CostumeInfo> | null = null;
  private items: Record<string, ItemInfo[]> | null = null;
  private readonly worn = new Map<LookSlot, Worn>();
  private readonly hidden = new Set<T.Object3D>();
  private readonly ticket = new Map<LookSlot, number>();
  look: Look = { ...EMPTY_LOOK, items: {} };

  constructor(
    private readonly THREE: Three,
    private readonly model: T.Object3D,
    private readonly load: (url: string) => Promise<{ scene: T.Object3D }>,
    /** 새 메시에 하루와 같은 셀 셰이더·외곽선을 입힌다. 더한 물체들(외곽선 포함)을 돌려준다 */
    private readonly dress: (mesh: T.SkinnedMesh, srcs: T.MeshStandardMaterial[]) => T.Object3D[],
  ) {}

  async costumes(): Promise<Record<string, CostumeInfo>> {
    if (!this.outfits) {
      try {
        this.outfits = (await (await fetch(BASE + "costumes.json")).json()) as Record<string, CostumeInfo>;
      } catch {
        this.outfits = {};
      }
    }
    return this.outfits;
  }

  async itemList(): Promise<Record<string, ItemInfo[]>> {
    if (!this.items) {
      try {
        this.items = (await (await fetch(BASE + "items.json")).json()) as Record<string, ItemInfo[]>;
      } catch {
        this.items = {};
      }
    }
    return this.items;
  }

  /** 한 가지 종류를 입히거나(id) 벗긴다(null) */
  async wear(slot: LookSlot, id: string | null): Promise<void> {
    const t = (this.ticket.get(slot) ?? 0) + 1;
    this.ticket.set(slot, t);
    if (!id) {
      this.remove(slot);
      delete this.look.items[slot];
      this.refreshHidden();
      return;
    }
    let file: string | null = null;
    let outfitHide: RegExp[] = [];
    if (slot === "outfit") {
      const info = (await this.costumes())[id];
      if (info) {
        file = info.file;
        outfitHide = info.slots.flatMap((s) => OUTFIT_HIDE[s] ?? []);
      }
    } else {
      file = (await this.itemList())[slot]?.find((i) => i.id === id)?.file ?? null;
    }
    if (!file) return;
    const gltf = await this.load(BASE + file);
    if (this.ticket.get(slot) !== t) return; // 그새 다른 것을 골랐음
    this.remove(slot);
    const w = this.attach(gltf.scene, slot);
    w.outfitHide = outfitHide;
    this.worn.set(slot, w);
    this.look.items[slot] = id;
    this.refreshHidden();
    this.applyColors();
  }

  /** 꾸밈 전체를 한 번에 (저장해 둔 것 불러오기) */
  async apply(look: Look): Promise<void> {
    this.look.skin = look.skin ?? "base";
    this.look.eyeColor = look.eyeColor ?? "base";
    this.look.hairColor = look.hairColor ?? "base";
    await Promise.all(LOOK_SLOTS.map((s) => this.wear(s, look.items?.[s] ?? null)));
    this.applyColors();
  }

  setColor(kind: "skin" | "eyeColor" | "hairColor", key: string): void {
    this.look[kind] = key;
    this.applyColors();
  }

  /** 피부·눈·머리카락 색을 지금 보이는 모든 재질(기본 부품 + 입힌 장식)에 */
  applyColors(): void {
    const skin = (SKIN_COLORS[this.look.skin] ?? SKIN_COLORS.base)[1];
    const eye = (EYE_COLORS[this.look.eyeColor] ?? EYE_COLORS.base)[1];
    const hair = (HAIR_COLORS[this.look.hairColor] ?? HAIR_COLORS.base)[1];
    this.model.traverse((o) => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh) return;
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as T.ShaderMaterial[]) {
        const u = m.uniforms;
        if (!u?.uColor || !u.uRecolor) continue;
        const ud = m.userData as { baseColor?: T.Color };
        if (!ud.baseColor) ud.baseColor = (u.uColor.value as T.Color).clone();
        const c = u.uColor.value as T.Color;
        c.copy(ud.baseColor);
        const rc = u.uRecolor.value as T.Vector4;
        rc.set(0, 0, 0, 0);
        if (SKIN_MAT.test(m.name)) c.multiply(new this.THREE.Color(skin[0], skin[1], skin[2]));
        else if (EYE_MAT.test(m.name) && eye) rc.set(eye[0], eye[1], eye[2], 0.85);
        else if (HAIR_MAT.test(m.name) && hair) rc.set(hair[0], hair[1], hair[2], 0.9);
      }
    });
  }

  private attach(scene: T.Object3D, slot: LookSlot): Worn {
    const THREE = this.THREE;
    const root = this.model.getObjectByName("haru_root") ?? this.model;
    scene.updateMatrixWorld(true);
    const byName = new Map<string, T.Object3D>();
    this.model.traverse((o) => {
      if ((o as T.Bone).isBone) byName.set(o.name.toLowerCase(), o);
    });
    const w: Worn = { objs: [], bones: [], hair: false, face: false, outfitHide: [] };
    const srcMeshes: T.SkinnedMesh[] = [];
    scene.traverse((o) => {
      if ((o as T.SkinnedMesh).isSkinnedMesh) srcMeshes.push(o as T.SkinnedMesh);
    });
    for (const sm of srcMeshes) {
      const bones = sm.skeleton.bones.map((b) => this.boneFor(b, byName, w, slot));
      if (bones.some((b) => !b)) continue;
      const skel = new THREE.Skeleton(bones as T.Bone[], sm.skeleton.boneInverses.map((m) => m.clone()));
      const srcs = (Array.isArray(sm.material) ? sm.material : [sm.material]) as T.MeshStandardMaterial[];
      for (const s of srcs) {
        if (HAS_HAIR.test(s.name)) w.hair = true;
        if (HAS_FACE.test(s.name)) w.face = true;
      }
      const mesh = new THREE.SkinnedMesh(sm.geometry, sm.material);
      mesh.name = `costume:${sm.name}`;
      mesh.frustumCulled = false;
      root.add(mesh);
      mesh.bind(skel, sm.bindMatrix.clone());
      w.objs.push(mesh, ...this.dress(mesh, srcs));
    }
    return w;
  }

  private boneFor(b: T.Bone, byName: Map<string, T.Object3D>, w: Worn, slot: LookSlot): T.Object3D | null {
    const own = byName.get(b.name.toLowerCase());
    if (own) return own;
    if (!(b.parent && (b.parent as T.Bone).isBone)) {
      // 장식 전용 뼈가 뼈대 맨 위에 붙어 있으면(게임에서는 머리 등의 붙이는 자리에 달림) 그 자리 뼈를 그대로 쓴다.
      // 이런 장식은 붙이는 자리 기준 좌표로 만들어져 있다 (바인드가 원점).
      return this.hostBone(slot);
    }
    const parent = this.boneFor(b.parent as T.Bone, byName, w, slot);
    if (!parent) return null;
    parent.add(b); // 부모 기준 자세는 그대로
    byName.set(b.name.toLowerCase(), b);
    w.bones.push(b);
    return b;
  }

  /** 장식 전용 뿌리 뼈를 붙일 하루 뼈 */
  private hostBone(slot: LookSlot): T.Object3D | null {
    const name = slot === "back" ? "Bip01_Spine2" : slot === "tail" || slot === "outfit" ? "Bip01_Pelvis" : ORPHAN_HEAD;
    return this.model.getObjectByName(name) ?? null;
  }

  private remove(slot: LookSlot): void {
    const w = this.worn.get(slot);
    if (!w) return;
    for (const o of w.objs) o.parent?.remove(o);
    for (const b of w.bones) b.parent?.remove(b);
    this.worn.delete(slot);
  }

  /** 입은 것에 따라 기본 부품·다른 장식을 가린다 */
  private refreshHidden(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden.clear();
    const hideMat: RegExp[] = [];
    let hideHair = false;
    let hideFace = false;
    for (const [slot, w] of this.worn) {
      hideMat.push(...w.outfitHide);
      // 머리카락·얼굴을 통째로 바꾸는 종류만 (머리 장식 등은 재질 이름에 HAIR 가 있어도 머리를 가리지 않음)
      if (w.hair && (slot === "hair" || slot === "hat" || slot === "mask")) hideHair = true;
      if (w.face && (slot === "face" || slot === "mask")) hideFace = true;
    }
    if (hideHair) hideMat.push(/^머리카락:/);
    if (hideFace) hideMat.push(/^얼굴:/);
    this.model.traverse((o) => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh || mesh.name.startsWith("costume:")) return;
      const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (ms.some((m) => hideMat.some((re) => re.test(m.name)))) {
        o.visible = false;
        this.hidden.add(o);
      }
    });
    // 모자·인형탈이 머리카락을 가지면 헤어 장식도 가린다 (두 머리가 겹침)
    const hairCover = (["hat", "mask"] as LookSlot[]).some((s) => this.worn.get(s)?.hair);
    const faceCover = this.worn.get("mask")?.face ?? false;
    const cover = (slot: LookSlot) => {
      for (const o of this.worn.get(slot)?.objs ?? []) {
        if (o.visible) {
          o.visible = false;
          this.hidden.add(o);
        }
      }
    };
    if (hairCover) cover("hair");
    if (faceCover) cover("face");
  }
}
