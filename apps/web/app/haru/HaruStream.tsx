"use client";

import { useEffect, useRef, useState } from "react";
import { onChatEvent, type ChatEvent } from "@/lib/chat-events";
import { FaceRig, NEUTRAL_FACE, type FaceParams } from "./face-rig";
import { AutoActor, type GestureName, type IdleName } from "./auto-actor";
import { GameFace, GAME_FACES, type GameFaceName } from "./game-face";
import { TypingPose } from "./typing-pose";
import { OcclusionFade } from "./occlusion-fade";
import { HairSway } from "./hair-sway";
import { GESTURES, HAND_POSES, type GestureDef, type HandGesture } from "./gesture-catalog";
import { HaruVoice } from "./voice";
import { CostumeWardrobe, EMPTY_LOOK, EYE_COLORS, HAIR_COLORS, SKIN_COLORS, type CostumeInfo, type ItemInfo, type Look, type LookSlot } from "./costume";

/**
 * 하루 방송 화면 — 마이룸 가구로 꾸민 방에서 책상 앞 의자에 앉아 방송하는 구도.
 *  - /haru/haru.glb : 하루(소울워커 PC_A 원본 변환). 애니메이션: stand idle1 idle2 hello laugh cheer sad dance
 *    hestia maid idol hero bunny servant sit(앉기, 정지 자세로만 사용) sit_idle battle_stand battle_idle battle_mode
 *  - /haru/room.glb : 방 소품(scripts/haru-room-export.py). 노드 이름 = 소품 키
 *
 * 하체는 늘 '앉기'를 재생하고, 상체(척추 위)만 몸짓 동작으로 바꾼다 → 앉은 채로 손 흔들기·웃기·만세 등.
 * 얼굴(깜빡임·립싱크·표정)은 face-rig + auto-actor 가 맡는다.
 */

const HARU_URL = "/haru/haru.glb";
const ROOM_URL = "/haru/room.glb";

/**
 * 감정 → 게임 몸짓 클립. 게임 몸짓은 모두 서서 하는 동작이라 앉은 몸에 얹으면 팔이 몸 옆으로 뻗치거나
 * 상체가 크게 꺾여 어색하다(사용자 확인). 그래서 앉은 방송 화면에서는 쓰지 않고, 감정 표현은
 * auto-actor 의 얼굴 + 작은 상체 몸짓(기울이기·어깨 들썩임)이 맡는다. 클립 재생 구조는 개발용으로 남겨 둔다.
 */
const EMOTION_CLIPS: Record<string, string[]> = {};

/**
 * 방 배치 (단위 m, 하루가 원점에서 +Z(카메라 쪽)를 본다).
 * rotY: 라디안, scale: 원본(cm→m 변환 뒤) 대비 배율.
 */
type Placement = { key: string; pos: [number, number, number]; rotY?: number; scale?: number };
const ROOM_LAYOUT: Placement[] = [
  { key: "chair", pos: [0, 0, -0.12], rotY: 0, scale: 0.9 },
  // 책상 다리 들어가는 빈 공간(책상 원점에서 약 -0.28m, 폭 약 1m) 한가운데가 하루 자리(x=0)에 오게 둔다.
  // 서랍장은 하루 오른쪽(화면 오른쪽) 아래에 온다.
  // z 는 손이 책상 앞쪽에 닿도록 당긴 값 (하루 팔 길이 약 38cm)
  { key: "desk", pos: [0.28, 0, 0.55], rotY: Math.PI, scale: 1 },
  { key: "haru_doll", pos: [0.95, 0.7, 0.45], rotY: -0.5, scale: 0.45 },
  { key: "cookie_doll", pos: [-0.5, 0.7, 0.82], rotY: 0.4, scale: 0.3 },
  { key: "window", pos: [-1.15, 1.45, -1.58], scale: 0.85 },
  { key: "poster", pos: [1.0, 1.55, -1.585], scale: 0.42 },
  { key: "shelf", pos: [-0.05, 1.95, -1.52], scale: 0.55 },
  { key: "bookcase", pos: [-2.15, 0, -1.25], rotY: 0.35, scale: 0.75 },
  { key: "bed", pos: [2.0, 0, -0.75], rotY: -Math.PI / 2, scale: 0.75 },
  { key: "teddy", pos: [1.75, 0.62, -1.15], rotY: -0.4, scale: 0.6 },
  { key: "drawer", pos: [-1.2, 0, -1.3], scale: 0.7 },
  { key: "donut", pos: [0.95, 0, -0.4], scale: 0.8 },
];
/**
 * 책상 모델(MR_desk_a)에 붙어 있는 소품을 잘라 옮긴다. box 는 책상 기준 좌표(m, 책상 위치·회전 기준),
 * move 는 장면 기준으로 옮길 양(m). 노트북은 하루 바로 앞(키보드가 손 아래), 스탠드·마우스는 오른쪽으로 비킨다.
 */
const DESK_CUTS: Array<{ name: string; box: { x: [number, number]; y: [number, number]; z: [number, number] }; move: [number, number, number] }> = [
  { name: "laptop", box: { x: [-0.23, 0.25], y: [0.69, 2], z: [-0.22, 0.17] }, move: [-0.27, 0, -0.25] },
  { name: "lamp", box: { x: [0.2, 0.7], y: [0.69, 2], z: [-0.31, 0.31] }, move: [-0.3, 0, 0.12] },
];
const ROOM = { backZ: -1.6, width: 6.4, height: 3.0, sideX: -2.9, depth: 4.2 };
/** 앉기 동작은 엉덩이(골반)가 원점에 오므로, 의자 앉는 높이만큼 하루를 올린다 (m) */
const SEAT_HEIGHT = 0.47;
/** 앉기 동작에서 정지 자세로 뽑을 시각(초). 기지개 전 가만히 앉은 장면 */
const SIT_POSE_TIME = 0;

/** 카메라 구도 (단위 m). position: 카메라 위치, target: 바라보는 점, fov: 세로 화각(도) */
interface CameraConfig {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}
const CAMERA_URL = "/haru/camera.json";
// 사용자가 '카메라 조정'으로 정한 구도 (2026-11-05). public/haru/camera.json 이 있으면 그 값이 우선한다.
/** 화각(줌) 범위 — 70° 가 가장 넓게 보이는 최대 줌아웃 */
const CAM_FOV_MIN = 20;
const CAM_FOV_MAX = 70;
/** 시점 돌리기: 화면 높이만큼 끌면 이 비율 × 한 바퀴. 좌우·위아래 최대(라디안) */
const CAM_ROTATE_SPEED = 0.35;
const CAM_YAW_MAX = 1.2;
const CAM_PITCH_MAX = 0.6;
const DEFAULT_CAMERA: CameraConfig = { position: [0, 1.088, 0.725], target: [0, 0.99, 0.05], fov: 43 }; // 좌우 0 = 하루 몸 중심선
function isCameraConfig(v: unknown): v is CameraConfig {
  const c = v as CameraConfig | null;
  const ok3 = (a: unknown) => Array.isArray(a) && a.length === 3 && a.every((x) => Number.isFinite(x));
  return !!c && ok3(c.position) && ok3(c.target) && Number.isFinite(c.fov);
}

type Three = typeof import("three");
type T3 = Three;

/** 동작 확인 버튼 (개발 모드에서만 화면 왼쪽에 보임) */
const PREVIEW_HAND: Array<[HandGesture, string]> = [
  ["wave", "손 흔들기"], ["clapLaugh", "손 모으고 웃기"], ["giggle", "입 가리고 킥킥"], ["shy", "수줍게 가슴에 손"],
  ["please", "두 손 모아 부탁"], ["scratch", "머리 긁적"], ["heart", "하트 손"], ["tear", "이마 짚기"],
  ["yawn", "하품 입 가리기"], ["coverEyes", "눈 가리기"], ["coverMouth", "놀라 입 가리기"],
  ["peace", "브이"], ["thumbsUp", "엄지척"], ["sip", "머그컵 마시기"],
  ["raise", "한 손 번쩍"], ["think", "턱 짚고 고민"], ["explain", "설명 손짓"],
];
const PREVIEW_BODY: Array<[GestureName, string]> = [
  ["laugh", "소리 내 웃기"], ["giggle", "어깨 들썩"], ["sway", "살랑살랑"], ["flinch", "움찔"], ["shrink", "움츠리기"],
  ["sigh", "한숨"], ["huff", "씩씩"], ["lean", "끄덕"], ["tilt", "갸웃"],
];
const PREVIEW_IDLE: Array<[IdleName, string]> = [
  ["lookAround", "방 둘러보기"], ["yawn", "하품"], ["bored", "지루한 한숨"], ["stretch", "목 풀기"], ["hum", "콧노래"], ["settle", "자세 고쳐 앉기"], ["drink", "커피 마시기"],
];
const PREVIEW_EMOTION: Array<[string, string]> = [
  ["joy", "기쁨"], ["love", "애정"], ["shy", "부끄러움"], ["surprised", "놀람"], ["sad", "슬픔"], ["angry", "화남"], ["neutral", "무표정"],
];
const GAME_FACE_LABEL: Record<GameFaceName, string> = {
  joyEyes: "눈웃음", smile: "미소", wink: "윙크", sad: "슬픈 눈", yawn: "하품", surprised: "눈 크게", shy: "수줍은 눈", soft: "부드러운 눈",
};
/** 꾸미기 창의 탭 */
type LookTabKey = LookSlot | "color";
const LOOK_TABS: Array<[LookTabKey, string]> = [
  ["outfit", "코스튬"], ["hair", "헤어"], ["hat", "모자"], ["mask", "인형탈"], ["hairAcc", "머리 장식"], ["ear", "귀걸이"],
  ["eye", "눈 장식"], ["mouth", "입 장식"], ["faceAcc", "얼굴 장식"], ["face", "얼굴"], ["back", "등 장식"], ["tail", "허리 장식"], ["color", "색"],
];
const SFX_LABEL: Record<string, string> = {
  laugh: "웃음", giggle: "킥킥", shyLaugh: "수줍은 웃음", sigh: "한숨", hmm: "흠", hum: "콧노래",
  surprise: "놀람", huff: "흥", sob: "흐느낌", cheer: "환호", wow: "감탄", effort: "영차",
};
const PREVIEW_MOOD: Array<[Mood | null, string]> = [[null, "실제 시각 따라"], ["day", "낮"], ["sunset", "노을"], ["night", "밤"]];
const SHOW_PREVIEW = process.env.NODE_ENV === "development";

export default function HaruStream() {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<{ hand: (k: HandGesture) => void; body: (n: GestureName) => void; mood: (m: Mood | null) => void; idle: (n: IdleName) => void; emotion: (e: string) => void; face: (f: GameFaceName) => void } | null>(null);
  const [status, setStatus] = useState<string>("방송 준비 중…");
  const voiceRef = useRef<HaruVoice | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [sfxPlayed, setSfxPlayed] = useState("");
  const wardrobeRef = useRef<CostumeWardrobe | null>(null);
  const [costumeOpen, setCostumeOpen] = useState(false);
  const [lookTab, setLookTab] = useState<LookTabKey>("outfit");
  const [outfits, setOutfits] = useState<Array<[string, CostumeInfo]>>([]);
  const [items, setItems] = useState<Record<string, ItemInfo[]>>({});
  const [look, setLook] = useState<Look>(EMPTY_LOOK);
  const [costumeBusy, setCostumeBusy] = useState(0);
  const saveLook = (w: CostumeWardrobe) => {
    setLook({ ...w.look, items: { ...w.look.items } });
    try {
      localStorage.setItem("haru-look", JSON.stringify(w.look));
    } catch {
      /* 무시 */
    }
  };
  const wearItem = (slot: LookSlot, id: string | null) => {
    const w = wardrobeRef.current;
    if (!w) return;
    setCostumeBusy((n) => n + 1);
    void w.wear(slot, id).finally(() => {
      setCostumeBusy((n) => n - 1);
      saveLook(w);
    });
  };
  const setLookColor = (kind: "skin" | "eyeColor" | "hairColor", key: string) => {
    const w = wardrobeRef.current;
    if (!w) return;
    w.setColor(kind, key);
    saveLook(w);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const THREE: Three = await import("three");
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      if (disposed) return;

      // ---------- 렌더러 / 장면
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x2a2230);
      const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 50); // 웹캠 정도의 화각
      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      const toon = createToon(THREE);

      // ---------- 불러오기 (하루 + 방 동시에)
      const loader = new GLTFLoader();
      const [gltf, roomGltf] = await Promise.all([
        loader.loadAsync(HARU_URL).catch((e: unknown) => {
          setStatus(`하루 3D 불러오기 실패: ${(e as Error)?.message ?? e}`);
          return null;
        }),
        loader.loadAsync(ROOM_URL).catch(() => null),
      ]);
      if (!gltf || disposed) return;

      // ---------- 방
      if (roomGltf) buildRoom(THREE, scene, roomGltf.scene, toon);

      // ---------- 하루
      const model = gltf.scene;
      let eyeNormal = new THREE.Vector3();
      const meshes: import("three").SkinnedMesh[] = [];
      model.traverse((o) => {
        if ((o as import("three").Mesh).isMesh) meshes.push(o as import("three").SkinnedMesh);
      });
      for (const mesh of meshes) {
        mesh.frustumCulled = false;
        const srcs = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as import("three").MeshStandardMaterial[];
        const replaced = srcs.map((m) => toon.make(m, 0));
        mesh.material = Array.isArray(mesh.material) ? replaced : replaced[0];
        const hasEye = srcs.some((m) => /EYE/i.test(m.name));
        if (!hasEye || srcs.length > 1) addOutline(THREE, mesh, srcs, toon, 0.14);
        if (/EYE/i.test(srcs[0].name) && mesh.geometry.attributes.normal) {
          const n = mesh.geometry.attributes.normal;
          const acc = new THREE.Vector3();
          for (let i = 0; i < n.count; i++) acc.add(new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)));
          eyeNormal = acc;
        }
      }
      model.position.y = SEAT_HEIGHT;
      scene.add(model);
      model.updateMatrixWorld(true);
      // 정면 맞추기: 눈 노멀이 +Z(카메라 쪽)를 보게
      if (eyeNormal.lengthSq() > 1e-6) {
        const root = model.getObjectByName("haru_root") ?? model;
        const q = new THREE.Quaternion();
        root.getWorldQuaternion(q);
        const dir = eyeNormal.clone().applyQuaternion(q);
        dir.y = 0;
        if (dir.lengthSq() > 1e-6) {
          dir.normalize();
          model.rotation.y = -Math.atan2(dir.x, dir.z);
        }
      }

      // ---------- 애니메이션: 앉은 정지 자세 위에 감정 몸짓(팔은 그대로, 척추·머리는 움직인 만큼만)
      // 원본 앉기 동작(sit)은 10초마다 기지개를 켜므로, 한 장면(SIT_POSE_TIME)만 뽑아 정지 자세로 쓴다.
      const mixer = new THREE.AnimationMixer(model);
      const stillClip = (clip: import("three").AnimationClip, t: number, name: string, keep: (tr: import("three").KeyframeTrack) => boolean) => {
        const tracks = clip.tracks.filter(keep).map((tr) => {
          // createInterpolant 는 실행 시 KeyframeTrack 에 있지만 타입 정의에는 빠져 있다
          const interp = (tr as unknown as { createInterpolant(): { evaluate(time: number): ArrayLike<number> } }).createInterpolant();
          const val = Array.from(interp.evaluate(Math.min(t, clip.duration)));
          const Ctor = tr.constructor as new (n: string, times: number[], values: number[]) => import("three").KeyframeTrack;
          return new Ctor(tr.name, [0], val);
        });
        return new THREE.AnimationClip(name, 1, tracks);
      };
      // 뼈 나누기
      //  - 척추 줄기(척추·목·머리): 앉은 자세를 유지하고 몸짓이 '움직인 만큼'만 더한다(가산 혼합) → 상체가 뒤로 젖혀지지 않음
      //  - 팔다리 쪽(쇄골·팔·손·머리카락·얼굴 뼈 등, Spine1 아래): 몸짓 자세를 그대로 따른다
      //  - 그 밖(골반·다리, 그리고 Spine 에 바로 붙은 허벅지 비틀림·치마 뼈): 늘 앉은 자세
      const boneOf = (tr: import("three").KeyframeTrack) => tr.name.split(".")[0];
      const SPINE_CHAIN = new Set(["Bip01_Spine", "Bip01_Spine1", "Bip01_Spine2", "Bip01_Neck", "Bip01_Head"]);
      const limbBones = new Set<string>();
      (model.getObjectByName("Bip01_Spine1") ?? null)?.traverse((o) => {
        if (!SPINE_CHAIN.has(o.name)) limbBones.add(o.name);
      });
      const isLimb = (tr: import("three").KeyframeTrack) => limbBones.has(boneOf(tr));
      const isChain = (tr: import("three").KeyframeTrack) => SPINE_CHAIN.has(boneOf(tr));
      const limbClips = new Map<string, import("three").AnimationClip>();
      const addClips = new Map<string, import("three").AnimationClip>();
      for (const c of gltf.animations) {
        if (c.name === "sit") {
          // 기본: 팔다리 쪽을 뺀 나머지 전부를 앉은 정지 자세로 고정 (늘 재생)
          mixer.clipAction(stillClip(c, SIT_POSE_TIME, "sit_core", (t) => !isLimb(t))).setLoop(THREE.LoopRepeat, Infinity).play();
          limbClips.set("sit", stillClip(c, SIT_POSE_TIME, "sit_limb", isLimb));
        } else {
          limbClips.set(c.name, new THREE.AnimationClip(`${c.name}_limb`, c.duration, c.tracks.filter(isLimb)));
          const add = new THREE.AnimationClip(`${c.name}_add`, c.duration, c.tracks.filter(isChain).map((t) => t.clone()));
          if (add.tracks.length) addClips.set(c.name, THREE.AnimationUtils.makeClipAdditive(add, 0));
        }
      }

      // ---------- 말할 때 손 제스처: 원본 몸짓의 한 구간에서 팔·손만 (얼굴·머리카락은 빼서 표정·립싱크는 따로 움직임)
      const headBones = new Set<string>();
      (model.getObjectByName("Bip01_Head") ?? null)?.traverse((o) => {
        if (o.name !== "Bip01_Head") headBones.add(o.name);
      });
      /** clip 의 [from, to] 구간을 30fps 로 다시 뽑아 0초부터 시작하는 클립으로 */
      const sliceClip = (
        clip: import("three").AnimationClip,
        from: number,
        to: number,
        name: string,
        keep: (tr: import("three").KeyframeTrack) => boolean,
      ) => {
        const tracks = clip.tracks.filter(keep).map((tr) => {
          const interp = (tr as unknown as { createInterpolant(): { evaluate(time: number): ArrayLike<number> } }).createInterpolant();
          const times: number[] = [];
          const values: number[] = [];
          for (let t = from; t <= to + 1e-6; t += 1 / 30) {
            times.push(t - from);
            values.push(...Array.from(interp.evaluate(t)));
          }
          const Ctor = tr.constructor as new (n: string, times: number[], values: number[]) => import("three").KeyframeTrack;
          return new Ctor(tr.name, times, values);
        });
        return new THREE.AnimationClip(name, to - from, tracks);
      };
      // 팔 뼈(쇄골부터 손가락까지) — 한 손 제스처에서 쓰지 않는 팔은 앉은 자세 그대로 두고 키보드 위로 보낸다
      const armBones = { L: new Set<string>(), R: new Set<string>() };
      for (const side of ["L", "R"] as const) {
        model.getObjectByName(`Bip01_${side}_Clavicle`)?.traverse((o) => armBones[side].add(o.name));
      }
      const sitLimbStill = limbClips.get("sit") ?? null;
      for (const [key, def] of Object.entries(GESTURES) as Array<[string, GestureDef]>) {
        const src = gltf.animations.find((c) => c.name === def.clip);
        if (!src) continue;
        const to = Math.min(def.to, src.duration);
        const gk = `gesture:${key}`;
        const idle = def.arms === "L" ? armBones.R : def.arms === "R" ? armBones.L : null; // 쓰지 않는 팔
        const limb = sliceClip(src, def.from, to, `${gk}_limb`, (t) => isLimb(t) && !headBones.has(boneOf(t)) && !idle?.has(boneOf(t)));
        if (idle && sitLimbStill) limb.tracks.push(...sitLimbStill.tracks.filter((t) => idle.has(boneOf(t))).map((t) => t.clone()));
        limbClips.set(gk, limb);
        // 척추·목·머리: 원본 첫 장면(바로 선 자세)에서 움직인 만큼만 더한다
        const add = sliceClip(src, def.from, to, `${gk}_add`, isChain);
        if (add.tracks.length) addClips.set(gk, THREE.AnimationUtils.makeClipAdditive(add, 0, stillClip(src, 0, `${gk}_ref`, isChain)));
      }

      const LOOP = "sit";
      // 손 제스처는 원본보다 느리게 — 원본 그대로는 앉아서 말하는 하루에게 너무 재빠르다
      const GESTURE_SPEED = 0.6;
      const GESTURE_FADE_IN = 0.6;
      const GESTURE_FADE_OUT = 0.8;
      let current: import("three").AnimationAction | null = null; // 팔다리 쪽 동작
      let currentAdd: import("three").AnimationAction | null = null; // 척추 줄기 가산 동작
      const play = (name: string, opts: { fade?: number; repeat?: number; addWeight?: number; speed?: number } = {}) => {
        const clip = limbClips.get(name);
        if (!clip) return null;
        const fade = opts.fade ?? 0.4;
        const rest = name === LOOP;
        const action = mixer.clipAction(clip);
        action.reset();
        action.enabled = true;
        action.timeScale = opts.speed ?? 1;
        if (rest) {
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
        } else {
          const n = Math.max(1, opts.repeat ?? 1);
          action.setLoop(n > 1 ? THREE.LoopRepeat : THREE.LoopOnce, n);
          action.clampWhenFinished = true;
        }
        if (current && current !== action && fade > 0) action.crossFadeFrom(current, fade, false);
        else if (current && current !== action) current.stop();
        action.play();
        current = action;
        // 척추 줄기: 이전 가산 동작은 서서히 빼고, 새 몸짓의 가산 동작을 서서히 넣는다
        if (currentAdd) currentAdd.fadeOut(fade);
        currentAdd = null;
        const addClip = rest ? null : addClips.get(name);
        if (addClip) {
          const add = mixer.clipAction(addClip);
          add.reset();
          add.timeScale = opts.speed ?? 1;
          const n = Math.max(1, opts.repeat ?? 1);
          add.setLoop(n > 1 ? THREE.LoopRepeat : THREE.LoopOnce, n);
          add.clampWhenFinished = true;
          add.setEffectiveWeight(opts.addWeight ?? 1);
          add.fadeIn(fade);
          add.play();
          currentAdd = add;
        }
        return action;
      };
      mixer.addEventListener("finished", (e) => {
        if (e.action === current) play(LOOP, { fade: e.action.getClip().name.startsWith("gesture:") ? GESTURE_FADE_OUT : 0.4 });
      });
      play(LOOP, { fade: 0 });
      const sitLimbClip = limbClips.get(LOOP) ?? null;
      /** 손 제스처(또는 다른 몸짓)를 하는 중인지 */
      const gestureBusy = () => (!!current && current.getClip() !== sitLimbClip) || typing.waving || typing.posing;
      let gestureArms: GestureDef["arms"] = "both"; // 지금 제스처가 쓰는 손
      let gestureReach: GestureDef["reach"] | null = null; // 지금 제스처의 손 위치 보정
      let gestureArc: GestureDef["arc"] | null = null; // 손을 올리고 내리는 도중의 우회
      let gestureFingers = 0; // 손가락 꼼지락 세기
      let gestureCurl: GestureDef["curl"] | null = null; // 손가락 굽힘 보정
      let gestureAction: import("three").AnimationAction | null = null; // 지금(또는 막 끝나 사라지는 중인) 제스처
      // 손짓에 어울리는 말 아닌 소리와 그 확률
      const HAND_SOUND: Partial<Record<HandGesture, [string, number]>> = {
        think: ["hmm", 0.7], clapLaugh: ["laugh", 0.8], giggle: ["giggle", 0.8], coverMouth: ["surprise", 0.8], tear: ["sob", 0.6],
        raise: ["cheer", 0.6], thumbsUp: ["cheer", 0.5], peace: ["giggle", 0.5], shy: ["shyLaugh", 0.5],
        coverEyes: ["shyLaugh", 0.5], heart: ["giggle", 0.4], explain: ["hmm", 0.2]
      };
      const playGesture = (key: HandGesture): boolean => {
        const ok = playGestureInner(key);
        const snd = HAND_SOUND[key];
        if (ok && snd && Math.random() < snd[1]) voice.playSfx(snd[0]);
        return ok;
      };
      const playGestureInner = (key: HandGesture): boolean => {
        if (gestureBusy()) return false;
        if (key === "wave") return typing.startWave(1); // 손 흔들기는 팔을 직접 계산 (키보드 자세 쪽)
        if (key in HAND_POSES) return typing.startPose(HAND_POSES[key as keyof typeof HAND_POSES]);
        if (!limbClips.has(`gesture:${key}`)) return false;
        const def: GestureDef = GESTURES[key as keyof typeof GESTURES];
        gestureArms = def.arms;
        gestureReach = def.reach ?? null;
        gestureArc = def.arc ?? null;
        gestureFingers = def.fingers ?? 0;
        gestureCurl = def.curl ?? null;
        gestureAction = play(`gesture:${key}`, { fade: GESTURE_FADE_IN, repeat: def.repeat, addWeight: def.spine ?? 0.6, speed: def.speed ?? GESTURE_SPEED });
        return !!gestureAction;
      };
      const stopGesture = () => {
        typing.stopWave();
        typing.stopPose();
        if (current && current.getClip() !== sitLimbClip) play(LOOP, { fade: 0.45 });
      };

      // ---------- 얼굴
      const rig = new FaceRig(THREE, model);
      const actor = new AutoActor();
      // 게임 원본 표정 층 (감정·하품 때 하루 원본 얼굴 움직임을 덧입힘)
      const gameFace = new GameFace(THREE, model, gltf.animations);
      // 채팅 치는 자세 (답을 기다리는 동안 두 손을 책상에)
      const typing = new TypingPose(THREE, model);
      const hair = new HairSway(THREE, model);
      // ---------- 머그컵: 노트북 오른쪽(하루 오른손 쪽). 마실 때는 손에 붙어 따라간다
      const mug = makeMug(THREE, toon);
      scene.add(mug);
      const MUG_SPOT = new THREE.Vector3(-0.222, DESK_TOP, 0.184); // 노트북 오른쪽, 몸 가까이 (팔꿈치를 굽힌 채 닿는 곳) // 오른손이 집으러 가는 자리에 맞춘 곳
      mug.position.copy(MUG_SPOT);
      mug.rotation.y = 1.38;
      // 쥔 컵 자리: 손바닥 안쪽(가운뎃손가락이 말려 들어가는 쪽)에 컵 몸통이 오고, 컵 위쪽은 엄지 쪽
      const MUG_TILT_MAX = 0.75; // 마실 때 컵이 기울 수 있는 최대 각(라디안, 약 43도)
      const MUG_GRIP = { along: 0.04, inward: 0.06, down: -0.066 }; // 컵 가운데쯤을 쥠 // 손목에서 손가락 쪽·손바닥 쪽·컵 축 방향(m)
      const mugBones = {
        hand: model.getObjectByName("Bip01_R_Hand"),
        mid: model.getObjectByName("Bip01_R_Finger2"),
        midTip: model.getObjectByName("Bip01_R_Finger21"),
        thumb: model.getObjectByName("Bip01_R_Finger0"),
      };
      const mv = { h: new THREE.Vector3(), m: new THREE.Vector3(), mt: new THREE.Vector3(), th: new THREE.Vector3(), f: new THREE.Vector3(), n: new THREE.Vector3(), up: new THREE.Vector3() };
      const deskQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 1.38, 0)); // 집을 때 손에 맞는 방향 (집는 순간 컵이 돌지 않게)
      const heldPos = new THREE.Vector3();
      const heldQ = new THREE.Quaternion();
      const mugM = new THREE.Matrix4();
      let mugBlend = 0;
      const updateMug = (dt: number) => {
        const hold = typing.holding;
        mugBlend += ((hold ? 1 : 0) - mugBlend) * (1 - Math.exp(-dt * 14));
        if (mugBlend < 0.002 || !mugBones.hand || !mugBones.mid || !mugBones.midTip || !mugBones.thumb) {
          mug.matrixAutoUpdate = true;
          mug.position.copy(MUG_SPOT);
          mug.quaternion.copy(deskQ);
          return;
        }
        mugBones.hand.getWorldPosition(mv.h);
        mugBones.mid.getWorldPosition(mv.m);
        mugBones.midTip.getWorldPosition(mv.mt);
        mugBones.thumb.getWorldPosition(mv.th);
        const f = mv.f.subVectors(mv.m, mv.h).normalize(); // 손가락 방향
        const n = mv.n.subVectors(mv.mt, mv.m); // 손가락이 말리는 쪽 = 손바닥 쪽
        n.addScaledVector(f, -n.dot(f)).normalize();
        const up = mv.up.crossVectors(f, n).normalize();
        if (up.dot(mv.th.sub(mv.h)) < 0) up.negate(); // 엄지 쪽이 컵 위
        // 손 방향만 따르면 컵이 옆(화면 좌우)으로도 기울어 어색하다 — 좌우 기울기는 없애고 앞뒤(입 쪽)로만 기울게
        up.x = 0;
        up.normalize();
        // 손목을 곧게 두면 컵이 손가락과 직각이라 너무 눕는다 — 기울기는 MUG_TILT_MAX 까지만 (나머지는 손 안에서 컵이 살짝 돌아간 셈)
        const tilt = Math.acos(Math.min(1, Math.max(-1, up.y)));
        if (tilt > MUG_TILT_MAX) {
          const h = Math.hypot(up.x, up.z) || 1;
          const sn = Math.sin(MUG_TILT_MAX);
          up.set((up.x / h) * sn, Math.cos(MUG_TILT_MAX), (up.z / h) * sn);
        }
        heldPos.copy(mv.h).addScaledVector(f, MUG_GRIP.along).addScaledVector(n, MUG_GRIP.inward).addScaledVector(up, MUG_GRIP.down);
        // 컵 축(Y) = up, 손잡이(X) = 하루 몸 쪽 (손가락에 걸리지 않고 컵 뒤로 숨음)
        const x = new THREE.Vector3(0, 0, -1).addScaledVector(up, up.z).normalize();
        const z = new THREE.Vector3().crossVectors(x, up);
        mugM.makeBasis(x, up, z);
        heldQ.setFromRotationMatrix(mugM);
        mug.matrixAutoUpdate = true;
        mug.position.copy(MUG_SPOT).lerp(heldPos, mugBlend);
        mug.quaternion.copy(deskQ).slerp(heldQ, mugBlend);
      };
      // ---------- 코스튬 갈아입히기
      const wardrobe = new CostumeWardrobe(THREE, model, (u) => loader.loadAsync(u), (mesh, srcs) => {
        const replaced = srcs.map((m) => toon.make(m, 0));
        mesh.material = replaced.length > 1 ? replaced : replaced[0];
        const parent = mesh.parent;
        if (!parent) return [];
        const before = new Set(parent.children);
        addOutline(THREE, mesh, srcs, toon, 0.14);
        return parent.children.filter((c) => !before.has(c));
      });
      wardrobeRef.current = wardrobe;
      void Promise.all([wardrobe.costumes(), wardrobe.itemList()]).then(([l, it]) => {
        if (disposed) return;
        setOutfits(Object.entries(l));
        setItems(it);
        let saved: Look | null = null;
        try {
          saved = JSON.parse(localStorage.getItem("haru-look") ?? "null") as Look | null;
          const old = localStorage.getItem("haru-costume"); // 예전에 고른 코스튬 한 벌
          if (!saved && old) saved = { ...EMPTY_LOOK, items: { outfit: old } };
        } catch {
          /* 무시 */
        }
        if (saved) void wardrobe.apply(saved).then(() => saveLook(wardrobe));
      });
      // 카메라와 하루 사이를 가리는 소품은 반투명
      const occlusion = new OcclusionFade(THREE, scene, model);
      actor.onGesture = playGesture;
      actor.onGestureStop = stopGesture;
      // 동작 확인 버튼: 하던 손짓을 멈추고, 손이 키보드로 돌아오면 바로 새 손짓
      let previewTimer = 0;
      previewRef.current = {
        hand: (k) => {
          window.clearTimeout(previewTimer);
          stopGesture();
          const t0 = performance.now();
          const tryPlay = () => {
            if (disposed || playGesture(k) || performance.now() - t0 > 3000) return;
            previewTimer = window.setTimeout(tryPlay, 50);
          };
          tryPlay();
        },
        body: (n) => actor.previewBodyGesture(n),
        mood: (m) => toon.setMood(m),
        idle: (n) => actor.previewIdle(n),
        emotion: (e) => actor.previewEmotion(e),
        face: (f) => gameFace.play(f),
      };
      actor.onExpression = (name) => {
        if (gameFace.has(name)) gameFace.play(name);
      };
      let faceOverride: Partial<FaceParams> | null = null;
      if (process.env.NODE_ENV !== "production") {
        const w = window as unknown as { __haruPlay?: (n: string) => void; __haruFace?: (p: Partial<FaceParams> | null) => void };
        w.__haruPlay = (n) => play(n);
        (window as unknown as { __haru?: unknown }).__haru = { THREE, scene, camera, model, actor, mixer, rig, renderer, clips: gltf.animations, gameFace, typing, occlusion, playGesture, gestureBusy, gestureArms: () => gestureArms, GESTURES, HAND_POSES, toon, hair, updateMug, wardrobe, gestureWeight: () => gestureAction?.getEffectiveWeight() ?? 0 };
        w.__haruFace = (p) => { faceOverride = p; };
      }

      // ---------- 카메라: 책상 너머 웹캠 위치에서 하루 상반신 + 뒤쪽 방
      // 기본 구도는 DEFAULT_CAMERA, /haru/camera.json 이 있으면 그 값(개발 모드 '카메라 조정'으로 저장한 구도)을 쓴다.
      mixer.update(0);
      model.updateMatrixWorld(true);
      const saved = await fetch(CAMERA_URL, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<CameraConfig>) : null))
        .catch(() => null);
      if (disposed) return;
      const camCfg: CameraConfig = isCameraConfig(saved) ? saved : DEFAULT_CAMERA;
      const basePos = new THREE.Vector3(...camCfg.position);
      const baseTarget = new THREE.Vector3(...camCfg.target);
      camera.fov = Math.min(CAM_FOV_MAX, Math.max(CAM_FOV_MIN, camCfg.fov));
      camera.updateProjectionMatrix();
      camera.position.copy(basePos);
      camera.lookAt(baseTarget);
      const headBone = model.getObjectByName("Bip01_Head") ?? null;
      const head = new THREE.Vector3();
      const headRest = new THREE.Vector3();
      if (headBone) headBone.getWorldPosition(headRest);
      const follow = new THREE.Vector3(); // 머리 움직임을 조금 따라가는 보정
      const tmpTarget = new THREE.Vector3();
      const FOLLOW = 0.2;
      // 보는 사람 시점 조작: 기본 구도에서 바라보는 점을 중심으로 돌린 만큼(yaw·pitch). 목표값으로 부드럽게 따라감
      const view = { yaw: 0, pitch: 0, yawT: 0, pitchT: 0 };
      const sph = new THREE.Spherical();
      const off = new THREE.Vector3();
      const orbit = (yaw: number, pitch: number, out: import("three").Vector3) => {
        sph.setFromVector3(out.subVectors(basePos, baseTarget));
        sph.theta += yaw;
        sph.phi = Math.min(Math.PI - 0.2, Math.max(0.2, sph.phi + pitch));
        return out.setFromSpherical(sph);
      };
      const followCamera = (dt: number) => {
        if (headBone) {
          headBone.getWorldPosition(head);
          const k = 1 - Math.exp(-dt * 2.5);
          follow.x += ((head.x - headRest.x) * FOLLOW - follow.x) * k;
          follow.y += ((head.y - headRest.y) * FOLLOW - follow.y) * k;
        }
        const kv = 1 - Math.exp(-dt * 10);
        view.yaw += (view.yawT - view.yaw) * kv;
        view.pitch += (view.pitchT - view.pitch) * kv;
        orbit(view.yaw, view.pitch, off);
        tmpTarget.copy(baseTarget).add(follow);
        camera.position.copy(tmpTarget).add(off);
        camera.lookAt(tmpTarget);
      };
      const setFovClamped = (v: number) => {
        camera.fov = Math.round(Math.min(CAM_FOV_MAX, Math.max(CAM_FOV_MIN, v)));
        camera.updateProjectionMatrix();
      };

      // 마우스·터치: 왼쪽 드래그 = 돌리기, 휠 = 화각 줌, 두 번 클릭 = 처음 구도
      const el = renderer.domElement;
      el.style.touchAction = "none";
      el.style.cursor = "grab";
      let drag: { id: number; x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
        el.style.cursor = "grabbing";
      };
      const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        const a = (2 * Math.PI * CAM_ROTATE_SPEED) / (el.clientHeight || 1);
        view.yawT = Math.min(CAM_YAW_MAX, Math.max(-CAM_YAW_MAX, view.yawT - (e.clientX - drag.x) * a));
        view.pitchT = Math.min(CAM_PITCH_MAX, Math.max(-CAM_PITCH_MAX, view.pitchT - (e.clientY - drag.y) * a));
        drag.x = e.clientX;
        drag.y = e.clientY;
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        el.style.cursor = "grab";
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        setFovClamped(camera.fov + Math.sign(e.deltaY) * 2);
      };
      const onDbl = () => {
        view.yawT = 0;
        view.pitchT = 0;
        setFovClamped(camCfg.fov);
      };
      const onCtx = (e: Event) => e.preventDefault(); // 오른쪽 클릭 메뉴 막기
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
      el.addEventListener("wheel", onWheel, { passive: false });
      el.addEventListener("dblclick", onDbl);
      el.addEventListener("contextmenu", onCtx);
      const viewOff = () => {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("dblclick", onDbl);
        el.removeEventListener("contextmenu", onCtx);
      };

      // ---------- 목소리 (하루 음성 서버, 문장 단위 재생 → 입 모양)
      const voice = new HaruVoice(actor);
      actor.onSound = (k) => voice.playSfx(k);
      // 키보드 소리: 손가락이 키를 누를 때마다. 손가락 움직임보다 실제 타자가 빨라서 절반쯤은 바로 뒤에 한 번 더
      typing.onKey = (_side, s) => {
        voice.keyClick(s);
        if (Math.random() < 0.5) window.setTimeout(() => voice.keyClick(s * 0.8), 70 + Math.random() * 60);
      };
      voiceRef.current = voice;
      setVoiceOn(voice.enabled);

      // ---------- 채팅 이벤트 → 동작
      const offChat = onChatEvent((ev: ChatEvent) => {
        actor.onChatEvent(ev);
        voice.onChatEvent(ev);
        if (ev.type === "emotion") {
          const cands = EMOTION_CLIPS[ev.emotion] ?? [];
          if (cands.length) play(cands[Math.floor(Math.random() * cands.length)]);
        }
      });
      setStatus("");

      // ---------- 루프
      const clock = new THREE.Clock();
      let raf = 0;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(0.1, clock.getDelta());
        rig.beforeMixer();
        mixer.update(dt);
        gameFace.update(dt, actor.talking);
        actor.faceOverlay = gameFace.weight;
        actor.faceOverlayMouth = gameFace.weight * gameFace.mouthWeight;
        model.updateMatrixWorld(true);
        voice.update(dt);
        let face: FaceParams = actor.update(dt);
        if (faceOverride) face = { ...NEUTRAL_FACE, ...faceOverride };
        rig.apply(face);
        // 제스처 동안은 손을 키보드에서 떼고, 끝나면 다시 키보드로
        // 손을 떼는 정도는 제스처 동작의 세기를 따르되 늦게 올라가게(세제곱 가까이) 한다.
        // 몸 애니메이션은 무릎 자세 ↔ 제스처로 섞이므로, 동작이 거의 바뀐 뒤에 손을 떼야 손이 책상·노트북을 지나가지 않는다
        const gw = gestureAction ? gestureAction.getEffectiveWeight() : 0;
        const rel = Math.pow(Math.min(1, Math.max(0, gw)), 2.5);
        typing.update(dt, actor.typingWeight, gestureArms !== "R" ? rel : 0, gestureArms !== "L" ? rel : 0);
        // 제스처 손 위치 보정 (얼굴에 파묻히거나 자리가 어긋나는 손을 옮김)
        if ((gestureReach || gestureArc) && gw > 0.001) {
          typing.nudge(1, gestureReach?.L, Math.min(1, gw), gestureArc?.L);
          typing.nudge(-1, gestureReach?.R, Math.min(1, gw), gestureArc?.R);
        }
        if (gestureCurl && gw > 0.001) {
          if (gestureCurl.L) typing.curlFingers(1, gestureCurl.L, Math.min(1, gw));
          if (gestureCurl.R) typing.curlFingers(-1, gestureCurl.R, Math.min(1, gw));
        }
        if (gestureFingers && gw > 0.001) {
          if (gestureArms !== "R") typing.wiggleFingers(1, gestureFingers, Math.min(1, gw));
          if (gestureArms !== "L") typing.wiggleFingers(-1, gestureFingers, Math.min(1, gw));
        }
        hair.update(dt);
        updateMug(dt);
        followCamera(dt);
        toon.updateMood(dt, scene);
        occlusion.update(dt, camera);
        renderer.render(scene, camera);
      };
      tick();

      cleanup = () => {
        cancelAnimationFrame(raf);
        viewOff();
        offChat();
        voice.dispose();
        voiceRef.current = null;
        ro.disconnect();
        mixer.stopAllAction();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })().catch((e) => setStatus(`3D 오류: ${(e as Error).message}`));

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="haru-stream">
      <div ref={hostRef} className="haru-stream-canvas" />
      <div className="haru-stream-overlay">
        <span className="haru-live-badge">LIVE</span>
        <span className="haru-stream-title">하루의 쉬는 시간 · 수다 방송</span>
      </div>
      {status && <div className="haru-stream-status">{status}</div>}
      <div className="haru-cam-hint">드래그: 돌리기 · 휠: 줌 · 두 번 클릭: 처음 구도</div>
      <button
        type="button"
        className="haru-voice-toggle"
        aria-pressed={voiceOn}
        title={voiceOn ? "하루 목소리 끄기" : "하루 목소리 켜기"}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={() => {
          const v = voiceRef.current;
          if (!v) return;
          v.setEnabled(!v.enabled);
          setVoiceOn(v.enabled);
        }}
      >
        {voiceOn ? "🔊 목소리" : "🔇 목소리"}
      </button>
      <button
        type="button"
        className="haru-costume-btn"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={() => setCostumeOpen(!costumeOpen)}
      >
        {costumeBusy > 0 ? "갈아입는 중…" : "꾸미기"}
      </button>
      {costumeOpen && (
        <div className="haru-costume-panel" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
          <div className="haru-look-tabs">
            {LOOK_TABS.map(([k, label]) => (
              <button key={k} type="button" className={lookTab === k ? "on" : ""} onClick={() => setLookTab(k)}>
                {label}
                {k !== "color" && look.items[k as LookSlot] ? " •" : ""}
              </button>
            ))}
          </div>
          {lookTab === "color" ? (
            <div className="haru-look-colors">
              {([["skin", "피부", SKIN_COLORS], ["eyeColor", "눈", EYE_COLORS], ["hairColor", "머리카락", HAIR_COLORS]] as const).map(([kind, label, table]) => (
                <div key={kind}>
                  <div className="haru-look-colors-head">{label}</div>
                  {Object.entries(table).map(([k, [name, rgb]]) => (
                    <button
                      key={k}
                      type="button"
                      title={name}
                      className={look[kind] === k ? "on" : ""}
                      style={{ background: rgb ? `rgb(${rgb.map((v) => Math.round(Math.min(1, v) * 230)).join(",")})` : undefined }}
                      onClick={() => setLookColor(kind, k)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="haru-look-grid">
              <button type="button" className={!look.items[lookTab as LookSlot] ? "on" : ""} onClick={() => wearItem(lookTab as LookSlot, null)}>
                <span className="haru-costume-noicon">{lookTab === "outfit" ? "기본" : "없음"}</span>
                <span>{lookTab === "outfit" ? "기본 옷" : "안 씀"}</span>
              </button>
              {(lookTab === "outfit"
                ? outfits.map(([k, c]) => ({ id: k, name: c.name, icon: c.icon }))
                : (items[lookTab] ?? [])
              ).map((c) => (
                <button key={c.id} type="button" className={look.items[lookTab as LookSlot] === c.id ? "on" : ""} onClick={() => wearItem(lookTab as LookSlot, c.id)}>
                  {c.icon ? <img src={`/haru/costume/${c.icon}`} alt="" loading="lazy" /> : <span className="haru-costume-noicon">?</span>}
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {SHOW_PREVIEW && (
        <PreviewPanel side="left" title="동작" unlock={() => voiceRef.current?.unlock()}>
          <PreviewSection id="hand" title="손 제스처">
            {PREVIEW_HAND.map(([k, label]) => (
              <button key={k} type="button" onClick={() => previewRef.current?.hand(k)}>{label}</button>
            ))}
          </PreviewSection>
          <PreviewSection id="idle" title="조용할 때 행동">
            {PREVIEW_IDLE.map(([n, label]) => (
              <button key={n} type="button" onClick={() => previewRef.current?.idle(n)}>{label}</button>
            ))}
          </PreviewSection>
          <PreviewSection id="mood" title="시간대 조명">
            {PREVIEW_MOOD.map(([m, label]) => (
              <button key={label} type="button" onClick={() => previewRef.current?.mood(m)}>{label}</button>
            ))}
          </PreviewSection>
          <PreviewSection id="body" title="상체 몸짓">
            {PREVIEW_BODY.map(([n, label]) => (
              <button key={n} type="button" onClick={() => previewRef.current?.body(n)}>{label}</button>
            ))}
          </PreviewSection>
        </PreviewPanel>
      )}
      {SHOW_PREVIEW && (
        <PreviewPanel side="right" title="표정·소리" unlock={() => voiceRef.current?.unlock()}>
          <PreviewSection id="emotion" title="감정 표정">
            {PREVIEW_EMOTION.map(([e, label]) => (
              <button key={e} type="button" onClick={() => previewRef.current?.emotion(e)}>{label}</button>
            ))}
          </PreviewSection>
          <PreviewSection id="sfx" title="소리 (누를 때마다 다음 것)">
            {Object.entries(SFX_LABEL).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  void voiceRef.current?.previewSfx(k).then((f) => setSfxPlayed(f ? `${label}: ${f}` : `${label}: 없음`));
                }}
              >
                {label}
              </button>
            ))}
            {sfxPlayed && <div className="haru-preview-note">{sfxPlayed}</div>}
          </PreviewSection>
          <PreviewSection id="gameface" title="게임 원본 표정">
            {(Object.keys(GAME_FACES) as GameFaceName[]).map((f) => (
              <button key={f} type="button" onClick={() => previewRef.current?.face(f)}>{GAME_FACE_LABEL[f]}</button>
            ))}
          </PreviewSection>
        </PreviewPanel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 동작 확인 버튼 묶음 (접고 펴기, 접힌 상태는 브라우저에 기억)
function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      if (s !== null) setV(s === "1");
    } catch {
      /* 저장소를 못 쓰면 기본값 */
    }
  }, [key]);
  const set = (nv: boolean) => {
    setV(nv);
    try {
      localStorage.setItem(key, nv ? "1" : "0");
    } catch {
      /* 무시 */
    }
  };
  return [v, set];
}

function PreviewPanel({ side, title, unlock, children }: { side: "left" | "right"; title: string; unlock: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useStoredFlag(`haru-preview-${side}`, true);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (!open) {
    return (
      <button type="button" className={`haru-preview-tab haru-preview-tab-${side}`} onPointerDown={stop} onDoubleClick={stop} onClick={() => setOpen(true)}>
        {side === "left" ? `${title} ▶` : `◀ ${title}`}
      </button>
    );
  }
  return (
    <div
      className={`haru-preview${side === "right" ? " haru-preview-right" : ""}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        unlock();
      }}
      onDoubleClick={stop}
      onWheel={stop}
    >
      <button type="button" className="haru-preview-close" onClick={() => setOpen(false)}>
        {side === "left" ? `◀ ${title} 접기` : `${title} 접기 ▶`}
      </button>
      {children}
    </div>
  );
}

function PreviewSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useStoredFlag(`haru-preview-sec-${id}`, true);
  return (
    <>
      <button type="button" className="haru-preview-head" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {title}
      </button>
      {open && children}
    </>
  );
}

// ---------------------------------------------------------------- 셀 셰이더 (게임 SWCellShading 느낌)
interface Toon {
  make: (src: import("three").MeshStandardMaterial, outline: number) => import("three").ShaderMaterial;
  /** 시간대 조명으로 서서히 옮겨 간다 (매 프레임) */
  updateMood: (dt: number, scene: import("three").Scene) => void;
  /** 시간대를 정한다. null 이면 실제 시각을 따른다 */
  setMood: (m: Mood | null) => void;
  mood: () => Mood;
}

/** 시간대 조명 */
export type Mood = "day" | "sunset" | "night";
interface MoodLight {
  key: [number, number, number]; // 빛 받는 쪽 색 배율
  shade: [number, number, number]; // 그늘 쪽 색 배율
  rim: [number, number, number]; // 뒤쪽 위에서 오는 테두리 빛
  glow: [number, number, number]; // 앞 아래 모니터 빛
  bg: [number, number, number]; // 배경색
}
const MOODS: Record<Mood, MoodLight> = {
  day: { key: [1.0, 0.98, 0.95], shade: [0.95, 0.95, 1.02], rim: [0.3, 0.28, 0.24], glow: [0.08, 0.09, 0.1], bg: [0.165, 0.133, 0.188] },
  sunset: { key: [1.0, 0.76, 0.58], shade: [0.62, 0.52, 0.72], rim: [0.6, 0.34, 0.16], glow: [0.2, 0.22, 0.3], bg: [0.2, 0.12, 0.14] },
  night: { key: [0.26, 0.28, 0.42], shade: [0.17, 0.19, 0.33], rim: [0.12, 0.18, 0.4], glow: [0.62, 0.72, 0.98], bg: [0.02, 0.02, 0.05] },
};
/** 실제 시각으로 시간대 고르기 */
function moodByClock(): Mood {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 7 && h < 17) return "day";
  if (h >= 17 && h < 19.5) return "sunset";
  return "night";
}

function createToon(THREE: T3): Toon {
  const VERT = /* glsl */ `
    #include <common>
    #include <skinning_pars_vertex>
    uniform float uOutline;
    uniform float uPush; // 외곽선을 카메라에서 이만큼(m) 뒤로 — 바로 뒤에 붙은 자기 몸에는 가려지게
    attribute float aOutline; // 정점별 외곽선 두께 배율 (입 주변 0)
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vUv = uv;
      #include <beginnormal_vertex>
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      vNormal = normalize(normalMatrix * objectNormal);
      #include <begin_vertex>
      #include <skinning_vertex>
      transformed += normalize(objectNormal) * uOutline * aOutline;
      vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
      vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
      if (uPush > 0.0) mvPosition.xyz += normalize(mvPosition.xyz) * uPush;
      vViewDir = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;
  const FRAG = /* glsl */ `
    uniform sampler2D map;
    uniform bool uHasMap;
    uniform vec3 uColor;
    uniform vec4 uShadow;
    uniform vec3 uLightDir;
    uniform float uRim;
    uniform float uAlphaTest;
    uniform float uOutline;
    uniform vec3 uOutlineColor;
    uniform float uFade; // 1 = 그대로, 낮을수록 반투명 (하루를 가릴 때)
    uniform vec4 uRecolor; // rgb = 물들일 색, a = 세기 (눈·머리카락 색 바꾸기)
    uniform float uFlat; // 1 = 얼굴·눈 (음영 없음 — 시간대 색과 모니터 빛만 약하게)
    uniform vec3 uKeyCol;
    uniform vec3 uShadeCol;
    uniform vec3 uRimCol;
    uniform vec3 uRimDir;
    uniform vec3 uGlowCol;
    uniform vec3 uGlowDir;
    uniform vec3 uGlowPos; // 노트북 화면 자리 (장면 기준)
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main() {
      vec4 c = vec4(uColor, 1.0);
      if (uHasMap) c *= texture2D(map, vUv);
      if (uRecolor.a > 0.0) {
        float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        c.rgb = mix(c.rgb, clamp(lum * uRecolor.rgb * 1.7, 0.0, 1.0), uRecolor.a);
      }
      if (c.a < uAlphaTest) discard;
      c.a *= uFade;
      if (uOutline > 0.0) {
        gl_FragColor = vec4(uOutlineColor, c.a);
        #include <colorspace_fragment>
        return;
      }
      vec3 n = normalize(vNormal);
      if (!gl_FrontFacing) n = -n;
      float ndl = dot(n, normalize(uLightDir));
      float lit = smoothstep(0.02, 0.18, ndl);
      vec3 shade = mix(c.rgb, uShadow.rgb, uShadow.a);
      vec3 col = mix(shade, c.rgb, lit);
      float rimF = 1.0 - max(dot(n, normalize(vViewDir)), 0.0);
      float rim = smoothstep(0.62, 0.92, rimF) * uRim * 0.55;
      col = mix(col, vec3(1.0), rim);
      // 시간대 빛: 빛 받는 쪽·그늘 쪽 색 (얼굴은 음영 없이 둘의 가운데)
      vec3 tone = mix(uShadeCol, uKeyCol, uFlat > 0.5 ? 0.75 : lit);
      col *= tone;
      // 뒤쪽 위 테두리 빛: 머리카락·어깨 가장자리만 밝게
      float back = smoothstep(0.55, 0.95, rimF) * max(dot(n, normalize(uRimDir)), 0.0);
      col += uRimCol * back * (1.0 - uFlat * 0.7);
      // 앞 아래 모니터 빛
      // 화면에서 가까울수록, 화면 쪽을 향한 면일수록 세게 (방 벽까지는 거의 닿지 않음)
      vec3 toGlow = uGlowPos - vWorldPos;
      float gd = length(toGlow) / 0.35;
      vec3 wn = normalize(vWorldNormal);
      if (!gl_FrontFacing) wn = -wn;
      float face = max(dot(wn, toGlow / max(length(toGlow), 1e-4)), 0.0);
      col += c.rgb * uGlowCol * (0.35 + 0.65 * face) * (1.0 - uFlat * 0.3) / (1.0 + gd * gd * gd * gd);
      gl_FragColor = vec4(col, c.a);
      #include <colorspace_fragment>
    }
  `;
  // 뷰 공간 빛 방향 (카메라 기준 왼쪽 위 앞)
  const lightDir = new THREE.Vector3(-0.45, 0.55, 0.75).normalize();
  // 모든 재질이 함께 쓰는 시간대 빛 (값 객체를 공유하므로 한 번 바꾸면 전부 바뀜)
  const shared = {
    uKeyCol: { value: new THREE.Color() },
    uShadeCol: { value: new THREE.Color() },
    uRimCol: { value: new THREE.Color() },
    uRimDir: { value: new THREE.Vector3(0.35, 0.75, -0.55).normalize() }, // 뷰 공간: 뒤쪽 위
    uGlowCol: { value: new THREE.Color() },
    uGlowDir: { value: new THREE.Vector3(0.05, -0.35, 1).normalize() }, // 뷰 공간: 앞 아래(노트북 화면)
    uGlowPos: { value: new THREE.Vector3(0, 0.86, 0.26) }, // 노트북 화면 가운데쯤
  };
  let forced: Mood | null = null;
  let cur: Mood = moodByClock();
  const now: MoodLight = JSON.parse(JSON.stringify(MOODS[cur]));
  const bg = new THREE.Color();
  const apply = () => {
    shared.uKeyCol.value.setRGB(...now.key);
    shared.uShadeCol.value.setRGB(...now.shade);
    shared.uRimCol.value.setRGB(...now.rim);
    shared.uGlowCol.value.setRGB(...now.glow);
  };
  apply();
  let clockCheck = 0;
  // 벽·바닥·천장(기본 재질)은 셰이더를 안 거치므로 원래 색에 시간대 색을 곱한다
  let basics: Array<{ m: import("three").MeshBasicMaterial; base: import("three").Color }> | null = null;
  const tone = new THREE.Color();
  return {
    setMood(m) {
      forced = m;
      clockCheck = 0;
    },
    mood: () => cur,
    updateMood(dt, scene) {
      clockCheck -= dt;
      if (clockCheck <= 0) {
        cur = forced ?? moodByClock();
        clockCheck = 30;
      }
      const target = MOODS[cur];
      const k = 1 - Math.exp(-dt * 1.5); // 몇 초에 걸쳐 서서히
      for (const f of ["key", "shade", "rim", "glow", "bg"] as const) {
        for (let i = 0; i < 3; i++) now[f][i] += (target[f][i] - now[f][i]) * k;
      }
      // 모니터 빛은 화면 내용에 따라 아주 살짝 일렁임
      const flicker = 1 + Math.sin(performance.now() / 1000 * 1.7) * 0.04 + Math.sin(performance.now() / 1000 * 5.3) * 0.02;
      apply();
      shared.uGlowCol.value.multiplyScalar(flicker);
      if (scene.background instanceof THREE.Color) scene.background.copy(bg.setRGB(...now.bg));
      if (!basics) {
        const found: Array<{ m: import("three").MeshBasicMaterial; base: import("three").Color }> = [];
        basics = found;
        scene.traverse((o) => {
          const mesh = o as import("three").Mesh;
          if (!mesh.isMesh) return;
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if ((m as import("three").MeshBasicMaterial).isMeshBasicMaterial) {
              const bm = m as import("three").MeshBasicMaterial;
              found.push({ m: bm, base: bm.color.clone() });
            }
          }
        });
      }
      // 벽은 빛 받는 쪽과 그늘의 가운데쯤
      tone.setRGB((now.key[0] + now.shade[0]) / 2, (now.key[1] + now.shade[1]) / 2, (now.key[2] + now.shade[2]) / 2);
      for (const b of basics) b.m.color.copy(b.base).multiply(tone);
    },
    make(src, outline) {
      const extras = (src.userData ?? {}) as { shadowColor?: number[]; rimAlpha?: number };
      const sc = extras.shadowColor ?? [0, 0, 0, 0.25];
      const shadowLin = new THREE.Color().setRGB(sc[0], sc[1], sc[2], THREE.SRGBColorSpace);
      const isEye = /EYE/i.test(src.name);
      // 게임 셰이더는 얼굴(MT_FACE)과 눈에 빛 음영을 넣지 않는다(_FaceRender_). 음영을 넣으면 코·볼에 큰 그림자가 져서 어색함
      const flat = isEye || /MT_FACE/i.test(src.name);
      const m = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          map: { value: src.map ?? null },
          uHasMap: { value: !!src.map },
          uColor: { value: (src.color ?? new THREE.Color(0xffffff)).clone() },
          uShadow: { value: new THREE.Vector4(shadowLin.r, shadowLin.g, shadowLin.b, flat ? 0 : sc[3]) },
          uLightDir: { value: lightDir },
          uRim: { value: flat ? 0 : extras.rimAlpha ?? 0 },
          uAlphaTest: { value: src.alphaTest > 0 ? src.alphaTest : src.transparent ? 0.02 : 0 },
          uOutline: { value: outline },
          uOutlineColor: { value: new THREE.Color(0x1a1114) },
          uFade: { value: 1 },
          uRecolor: { value: new THREE.Vector4(0, 0, 0, 0) },
          uPush: { value: 0 },
          uFlat: { value: flat ? 1 : 0 },
          ...shared,
        },
        side: outline > 0 ? THREE.BackSide : src.side,
        transparent: src.transparent,
        depthWrite: !src.transparent || outline > 0,
      });
      m.name = src.name;
      return m;
    },
  };
}

/** 입술·턱·이 뼈 — 입이 움직일 때 외곽선 껍질이 입가로 비집고 나와 검은 줄이 생기므로 이 부분은 외곽선을 뺀다 */
/** 얼굴 메시 외곽선 두께 배율 */
const FACE_OUTLINE_SCALE = 1; // 전체 외곽선을 절반으로 줄였으므로 얼굴만 따로 줄이지 않음
const MOUTH_BONE = /xtra1[0-9]|lip|teeth/i; // 턱 뼈(Xtra07)는 빼지 않는다 — 턱선 윤곽선이 사라짐

/** 정점별 외곽선 두께 배율 aOutline 을 만든다. 입 뼈에 붙은 정도만큼 0 으로 */
function ensureOutlineWeights(THREE: T3, mesh: import("three").Mesh, cutEdges = false) {
  const g = mesh.geometry;
  if (g.getAttribute("aOutline")) return;
  const n = g.getAttribute("position").count;
  const w = new Float32Array(n).fill(1);
  const sm = mesh as import("three").SkinnedMesh;
  const si = g.getAttribute("skinIndex");
  const sw = g.getAttribute("skinWeight");
  if (sm.isSkinnedMesh && sm.skeleton && si && sw) {
    const mouth = sm.skeleton.bones.map((b) => MOUTH_BONE.test(b.name));
    if (mouth.some(Boolean)) {
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let k = 0; k < 4; k++) if (mouth[si.getComponent(i, k)]) m += sw.getComponent(i, k);
        // 외곽선 두께를 넓고 완만하게 줄인다 — 갑자기 0 이 되면 그 경계가 코 밑에 검은 선으로 보임
        const x = Math.min(1, Math.max(0, m / 0.6));
        w[i] = 1 - x * x * (3 - 2 * x);
      }
    }
  }
  // 부품 이음매(손목·발목): 손·팔·양말이 따로 된 메시라 열린 가장자리에서 외곽선 껍질이 고리처럼 튀어나온다.
  // 이음매 가장자리 정점은 외곽선을 빼고, 바로 옆 네 줄은 서서히 되돌린다.
  if (sm.isSkinnedMesh && sm.skeleton && si && sw) {
    const seamBone = sm.skeleton.bones.map((b) => SEAM_BONE.test(b.name));
    const mainBone = (i: number) => {
      let best = -1;
      let bi = 0;
      for (let k = 0; k < 4; k++) {
        const v = sw.getComponent(i, k);
        if (v > best) {
          best = v;
          bi = si.getComponent(i, k);
        }
      }
      return bi;
    };
    seamFade(g, w, (i) => seamBone[mainBone(i)], [0, 0.2, 0.45, 0.7, 0.9]);
  }
  // 방 소품을 잘라 옮긴 메시: 잘린 가장자리에 외곽선 껍질이 검은 선으로 남으므로 가장자리 외곽선을 뺀다
  if (cutEdges) seamFade(g, w, () => true, [0]);
  // 얼굴(턱선) 외곽선은 절반 두께 — 다른 부위와 같으면 턱선이 너무 굵어 보임
  const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Array<{ name?: string }>;
  if (mats.some((m) => /MT_FACE/i.test(m.name ?? ""))) for (let i = 0; i < n; i++) w[i] *= FACE_OUTLINE_SCALE;
  g.setAttribute("aOutline", new THREE.BufferAttribute(w, 1));
}

/** 이음매 뼈 — 이 뼈에 붙은 열린 가장자리는 다른 부품과 맞닿는 자리 */
const SEAM_BONE = /forearm|_hand|calf/i;

/** 열린 가장자리(삼각형 하나에만 속한 변) 중 isSeam 인 정점의 외곽선을 scale[0] 배로, 이웃 줄은 scale[1..] 배로 */
function seamFade(g: import("three").BufferGeometry, w: Float32Array, isSeam: (vertex: number) => boolean, scale: number[]) {
  const pos = g.getAttribute("position");
  const idx = g.getIndex();
  if (!idx) return;
  // UV 이음 때문에 같은 자리 정점이 여럿일 수 있어 위치로 묶는다
  const keyOf = new Int32Array(pos.count);
  const keys = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let id = keys.get(k);
    if (id === undefined) keys.set(k, (id = keys.size));
    keyOf[i] = id;
  }
  const edges = new Map<number, number>();
  const nbr: Array<Set<number>> = Array.from({ length: keys.size }, () => new Set<number>());
  const n = keys.size;
  for (let t = 0; t < idx.count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = keyOf[idx.getX(t + k)];
      const b = keyOf[idx.getX(t + ((k + 1) % 3))];
      if (a === b) continue;
      const e = a < b ? a * n + b : b * n + a;
      edges.set(e, (edges.get(e) ?? 0) + 1);
      nbr[a].add(b);
      nbr[b].add(a);
    }
  }
  const seamKey = new Uint8Array(n);
  for (let i = 0; i < pos.count; i++) if (isSeam(i)) seamKey[keyOf[i]] = 1;
  const ring = new Int8Array(n).fill(-1);
  let front: number[] = [];
  for (const [e, c] of edges) {
    if (c !== 1) continue;
    for (const v of [Math.floor(e / n), e % n]) {
      if (ring[v] === -1 && seamKey[v]) {
        ring[v] = 0;
        front.push(v);
      }
    }
  }
  if (!front.length) return;
  for (let r = 1; r < scale.length; r++) {
    const next: number[] = [];
    for (const v of front) for (const u of nbr[v]) if (ring[u] === -1) { ring[u] = r; next.push(u); }
    front = next;
  }
  for (let i = 0; i < pos.count; i++) {
    const r = ring[keyOf[i]];
    if (r >= 0) w[i] *= scale[r];
  }
}

/** 팔·손 메시 이름, 외곽선을 뒤로 밀 거리(m) */
const ARM_MESH = /^(몸_2|mesh손)$/;
const ARM_OUTLINE_PUSH = 0.04; // 사용자 선택: 가장 자연스러움 (0.06 은 팔 바깥 윤곽까지 옅어짐)

/** 같은 메시를 뒤집어(BackSide) 법선 방향으로 부풀려 한 번 더 그려 외곽선을 만든다 (두께 단위 = 원본 cm) */
/** 책상 윗면 높이(m) */
const DESK_TOP = 0.705;

/** 머그컵 손잡이 방향(컵 기준 x, z) — 쥔 손가락이 오는 쪽 */
const MUG_HANDLE_DIR = [-0.77, -0.64] as const;
/** 머그컵 (분홍 컵 + 손잡이 + 커피). 바닥 가운데가 원점 */
function makeMug(THREE: T3, toon: Toon): import("three").Group {
  const g = new THREE.Group();
  g.name = "mug"; // room: 이름이 아니라 하루를 가려도 반투명이 되지 않음 (손에 든 컵은 늘 또렷하게)
  const pink = new THREE.MeshStandardMaterial({ color: 0xf6b8c8, name: "mug" });
  const coffee = new THREE.MeshStandardMaterial({ color: 0x5a3422, name: "coffee" });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, 0.085, 24, 1, true), pink);
  body.position.y = 0.0425;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), pink);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = 0.001;
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.032, 24), coffee);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.072;
  // 손잡이: 쥔 손가락이 컵 몸통에서 2~3cm 떨어져 갈고리처럼 걸리는 자리(컵 기준 뒤쪽 비스듬히)에 단다
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0065, 8, 20, Math.PI), pink);
  handle.rotation.set(0, Math.atan2(MUG_HANDLE_DIR[1], MUG_HANDLE_DIR[0]) * -1, -Math.PI / 2, "YXZ");
  handle.position.set(MUG_HANDLE_DIR[0] * 0.031, 0.046, MUG_HANDLE_DIR[1] * 0.031);
  for (const m of [body, bottom, top, handle] as import("three").Mesh[]) {
    const src = m.material as import("three").MeshStandardMaterial;
    const tm = toon.make(src, 0);
    tm.side = THREE.DoubleSide;
    m.material = tm;
    g.add(m);
    if (m !== top) {
      const ol = new THREE.Mesh(m.geometry, toon.make(src, 0.0018));
      ol.position.copy(m.position);
      ol.rotation.copy(m.rotation);
      ol.renderOrder = -1;
      m.geometry.setAttribute("aOutline", new THREE.BufferAttribute(new Float32Array(m.geometry.getAttribute("position").count).fill(1), 1));
      g.add(ol);
    }
  }
  return g;
}

function addOutline(
  THREE: T3,
  mesh: import("three").Mesh,
  srcs: import("three").MeshStandardMaterial[],
  toon: Toon,
  thickness: number,
  cutEdges = false,
) {
  ensureOutlineWeights(THREE, mesh, cutEdges);
  const ol = mesh.clone();
  const mats = srcs.map((m) => {
    const om = toon.make(m, thickness);
    if (/EYE/i.test(m.name) || m.transparent) om.uniforms.uAlphaTest.value = 2; // 눈·유리는 외곽선 없음
    return om;
  });
  // 팔(아래팔이 카메라 쪽을 향함): 팔꿈치에서 아래팔 윤곽이 위팔 위에 선으로 그려지므로 외곽선을 뒤로 민다
  if (ARM_MESH.test(mesh.name)) for (const om of mats) om.uniforms.uPush.value = ARM_OUTLINE_PUSH;
  ol.material = Array.isArray(mesh.material) ? mats : mats[0];
  ol.renderOrder = -1;
  mesh.parent?.add(ol);
}

// ---------------------------------------------------------------- 방 꾸미기
/**
 * holder(책상) 아래 메시들에서 box 안에 있는 삼각형만 잘라 새 메시로 만들고, 장면에 move 만큼 옮겨 놓는다.
 * 잘린 삼각형은 원래 메시에서 빠진다. 새 메시는 원래 재질을 그대로 쓴다(뒤에서 셀 셰이더로 바뀜).
 */
function cutFromMeshes(
  THREE: T3,
  scene: import("three").Scene,
  holder: import("three").Object3D,
  meshes: import("three").Mesh[],
  cut: (typeof DESK_CUTS)[number],
): import("three").Mesh[] {
  const out: import("three").Mesh[] = [];
  const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const pos = g.getAttribute("position");
    const idx = g.getIndex();
    if (!pos || !idx) continue;
    // 메시 → 책상 기준 좌표
    const toHolder = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const keep: number[] = [];
    const take: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
      c.set(0, 0, 0);
      for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, idx.getX(t + k)).applyMatrix4(toHolder));
      c.multiplyScalar(1 / 3);
      const inBox =
        c.x >= cut.box.x[0] && c.x <= cut.box.x[1] && c.y >= cut.box.y[0] && c.y <= cut.box.y[1] && c.z >= cut.box.z[0] && c.z <= cut.box.z[1];
      (inBox ? take : keep).push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
    }
    if (!take.length) continue;
    // 옮겨 갈 조각 중 전선·얇은 띠(책상 위에 붙은 작은 덩어리)는 버린다 — 옮기면 책상 위 검은 선으로 보임
    const taken = dropDeskScraps(THREE, pos, take, toHolder);
    if (!taken.length) {
      g.setIndex(keep);
      continue;
    }
    take.length = 0;
    take.push(...taken);
    g.setIndex(keep);
    const ng = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) ng.setAttribute(name, g.getAttribute(name));
    ng.setIndex(take);
    const nm = new THREE.Mesh(ng, mesh.material);
    nm.name = `${cut.name}`;
    // 원래 자리(장면 기준) 그대로 두고 move 만큼 옮긴다
    mesh.matrixWorld.decompose(nm.position, nm.quaternion, nm.scale);
    nm.position.add(new THREE.Vector3(...cut.move));
    const grp = new THREE.Group();
    grp.name = `room:${cut.name}`;
    grp.add(nm);
    scene.add(grp);
    out.push(nm);
  }
  return out;
}

/**
 * 삼각형 목록(take, 정점 번호 3개씩)을 이어진 덩어리로 나눠, 책상 위 전선·얇은 띠를 뺀 목록을 돌려준다.
 *  - 가는 띠: 높이 6mm 미만이면서 가로·세로 중 짧은 쪽이 1cm 미만 (마우스 패드·종이처럼 넓은 납작한 소품은 남김)
 *  - 전선: 책상 바로 위(꼭대기 0.705~0.712m)에 깔린 30개 이하 삼각형 덩어리
 * (좌표는 책상 기준 m, 책상 윗면 0.70m)
 */
function dropDeskScraps(
  THREE: T3,
  pos: import("three").BufferAttribute | import("three").InterleavedBufferAttribute,
  take: number[],
  toHolder: import("three").Matrix4,
): number[] {
  const id = new Map<string, number>();
  const par: number[] = [];
  const find = (x: number) => {
    while (par[x] !== x) x = par[x] = par[par[x]];
    return x;
  };
  const kid = (i: number) => {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let v = id.get(k);
    if (v === undefined) {
      v = par.length;
      id.set(k, v);
      par.push(v);
    }
    return v;
  };
  const first: number[] = [];
  for (let t = 0; t < take.length; t += 3) {
    const a = kid(take[t]);
    const b = kid(take[t + 1]);
    const c = kid(take[t + 2]);
    first.push(a);
    par[find(a)] = find(b);
    par[find(b)] = find(c);
  }
  const info = new Map<number, { n: number; lo: number; hi: number; x0: number; x1: number; z0: number; z1: number }>();
  const v = new THREE.Vector3();
  for (let t = 0; t < take.length; t += 3) {
    const r = find(first[t / 3]);
    let c = info.get(r);
    if (!c) info.set(r, (c = { n: 0, lo: Infinity, hi: -Infinity, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }));
    c.n++;
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, take[t + k]).applyMatrix4(toHolder);
      c.lo = Math.min(c.lo, v.y);
      c.hi = Math.max(c.hi, v.y);
      c.x0 = Math.min(c.x0, v.x);
      c.x1 = Math.max(c.x1, v.x);
      c.z0 = Math.min(c.z0, v.z);
      c.z1 = Math.max(c.z1, v.z);
    }
  }
  const out: number[] = [];
  for (let t = 0; t < take.length; t += 3) {
    const c = info.get(find(first[t / 3]))!;
    const flat = c.hi - c.lo < 0.006 && Math.min(c.x1 - c.x0, c.z1 - c.z0) < 0.01;
    // 전선은 책상에서 살짝 떠 있다(꼭대기 0.706~0.712m). 마우스 패드·종이는 책상에 붙어 있어(0.703m 이하) 남긴다
    const cable = c.hi > 0.705 && c.hi <= 0.712 && c.n <= 30;
    if (!flat && !cable) out.push(take[t], take[t + 1], take[t + 2]);
  }
  return out;
}

function buildRoom(THREE: T3, scene: import("three").Scene, room: import("three").Object3D, toon: Toon) {
  const byKey = new Map<string, import("three").Object3D>();
  for (const child of [...room.children]) byKey.set(child.name, child);

  // 벽지·바닥: 50cm 견본 텍스처를 큰 면에 반복
  const tileMat = (key: string, tileM: number, w: number, h: number, fallback: number) => {
    let map: import("three").Texture | null = null;
    byKey.get(key)?.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (mesh.isMesh && !map) map = ((mesh.material as import("three").MeshStandardMaterial).map ?? null);
    });
    const mat = new THREE.MeshBasicMaterial({ color: map ? 0xffffff : fallback });
    if (map) {
      const t = (map as import("three").Texture).clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(w / tileM, h / tileM);
      t.needsUpdate = true;
      mat.map = t;
    }
    return mat;
  };
  const back = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.height), tileMat("wallpaper", 0.5, ROOM.width, ROOM.height, 0xf4d9e4));
  back.position.set(0, ROOM.height / 2, ROOM.backZ);
  scene.add(back);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.depth, ROOM.height), tileMat("wallpaper", 0.5, ROOM.depth, ROOM.height, 0xf4d9e4));
  side.position.set(ROOM.sideX, ROOM.height / 2, ROOM.backZ + ROOM.depth / 2);
  side.rotation.y = Math.PI / 2;
  (side.material as import("three").MeshBasicMaterial).color.setScalar(0.88); // 옆벽은 살짝 어둡게
  scene.add(side);
  const sideR = side.clone();
  sideR.material = (side.material as import("three").MeshBasicMaterial).clone();
  sideR.position.x = -ROOM.sideX;
  sideR.rotation.y = -Math.PI / 2;
  scene.add(sideR);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), new THREE.MeshBasicMaterial({ color: 0xf7efe6 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, ROOM.height, ROOM.backZ + ROOM.depth / 2);
  scene.add(ceil);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), tileMat("floor", 0.5, ROOM.width, ROOM.depth, 0xd9b38c));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, ROOM.backZ + ROOM.depth / 2);
  scene.add(floor);

  // 가구
  for (const item of ROOM_LAYOUT) {
    const src = byKey.get(item.key);
    if (!src) continue;
    const holder = new THREE.Group();
    holder.add(src);
    holder.position.set(...item.pos);
    holder.rotation.y = item.rotY ?? 0;
    holder.scale.setScalar(item.scale ?? 1);
    const meshes: import("three").Mesh[] = [];
    src.traverse((o) => {
      if ((o as import("three").Mesh).isMesh) meshes.push(o as import("three").Mesh);
    });
    // 책상 모델에 한 덩어리로 붙은 노트북·스탠드를 잘라 따로 옮긴다
    if (item.key === "desk") {
      holder.updateMatrixWorld(true);
      // 책상 몸체(MR_desk_a)는 자르지 않고 소품 메시(MR_desk_ab)만 자른다 — 소품 바닥(0.70m)까지 잘라야 자국이 안 남음
      const isProps = (m: import("three").Mesh) => !/MR_desk_a$/.test((Array.isArray(m.material) ? m.material[0] : m.material).name);
      for (const cut of DESK_CUTS) meshes.push(...cutFromMeshes(THREE, scene, holder, meshes.filter(isProps), cut));
    }
    for (const mesh of meshes) {
      const srcs = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as import("three").MeshStandardMaterial[];
      const mats = srcs.map((m) => toon.make(m, 0));
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      // 책상은 노트북·스탠드를 잘라 냈으므로 잘린 가장자리 외곽선을 뺀다
      addOutline(THREE, mesh, srcs, toon, 0.175, item.key === "desk");
    }
    holder.name = `room:${item.key}`;
    scene.add(holder);
  }
}
