# -*- coding: utf-8 -*-
"""
소울워커 '하루'(PC_A) 게임 원본(.model/.anim) → GLB 변환기 (개발 PC 전용, 1회성)

- 소울워커 위키 프로젝트(E:\\Soul_Worker\\SW_Wiki\\tools)의 해석기(actmode.py, models.py)를 그대로 빌려 쓴다.
- 기본 부품(머리카락·얼굴·몸·바지·기본 코스튬 상/하의·손·발)을 한 뼈대로 합치고, 대화 연출용 애니메이션 몇 개를 넣는다.
- 출력: apps/web/public/haru/haru.glb  (웹 채팅 화면의 3D 동반자용)

실행:  python scripts/haru-export-glb.py            (레포 루트에서)
환경:  Python 3.11 + numpy + Pillow(DDS 디코드). SW_WIKI 환경변수로 위키 폴더를 바꿀 수 있다.
"""
import base64
import gzip
import io
import json
import os
import struct
import sys

import numpy as np

SW_WIKI = os.environ.get("SW_WIKI") or r"E:\Soul_Worker\SW_Wiki"
sys.path.insert(0, os.path.join(SW_WIKI, "tools"))
import actmode  # noqa: E402
import models as swmodels  # noqa: E402

from PIL import Image  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "apps", "web", "public", "haru", "haru.glb")
ASSETS = actmode.ASSETS
CODE = "PC_A"

# 하루 기본 외형 부품 (툴테이블 tb_Character_Info PC_A → tb_Character_Parts 의 Model_File_1 과 동일)
PARTS = [
    ("머리카락", "Character/Player/PC_A/PC_A_Parts_Default_Hair_01"),
    ("얼굴", "Character/Player/PC_A/PC_A_Parts_Default_Face_02"),
    ("몸", "Character/Player/PC_A/PC_A_Parts_Default_Body_03"),  # 피부 + 흰 나시
    ("손", "Character/Player/PC_A/PC_A_Parts_Default_Hands_04"),
    ("발", "Character/Player/PC_A/PC_A_Parts_Default_Foot_05"),
    ("하의", "Character/Player/PC_A/PC_A_Parts_Default_Pants_07"),  # 피부 + 분홍 반바지
    # Cash_Body_08 / Cash_Pants_09 는 속옷(브라·팬티, 자원 폴더 Underwear)이다. 위 몸·하의와 피부가 겹쳐
    # 몸이 두 겹으로 그려지고 배가 뚫려 보이므로 넣지 않는다.
]

# 대화 연출용 애니메이션: (GLB 안의 이름, 원본 시퀀스 이름, 반복 여부)
ANIMS = [
    ("stand", "N_Stand", True),
    ("idle1", "N_Idle_01", False),
    ("idle2", "N_Idle_02", False),
    ("hello", "N_Gesture_Hello", False),
    ("laugh", "N_Gesture_Laugh", False),
    ("cheer", "N_Gesture_Cheer", False),
    ("sad", "N_Gesture_Sad", False),
    ("dance", "N_Gesture_Dance", False),
    ("hestia", "N_Gesture_Hestia", False),
    ("maid", "N_Gesture_Maid", False),
    ("idol", "N_Gesture_Idol", False),
    ("hero", "N_Gesture_Hero", False),
    ("bunny", "N_Gesture_Bunny", False),
    ("servant", "N_Gesture_Servant", False),
    ("sit", "N_Room_Chair_A_Loop", True),  # 의자에 앉아 있기 (방송 화면 기본)
    ("sit_idle", "N_Room_Chair_A_Idle", False),  # 앉은 채 가벼운 대기 동작
    ("battle_stand", "B_Stand", True),
    ("battle_idle", "B_Idle_01", False),
    ("battle_mode", "N_B_Mode", False),
    # 방송 중 말할 때 쓰는 손 제스처 (앉은 자세에 팔만 입혀 쓰고, 쓸 구간은 화면 쪽 gesture-catalog 에서 자른다)
    ("g_wave", "N_Gesture_GG02_Loop", False),
    ("g_shy", "N_Gesture_SchoolMizugi", False),
    ("g_please", "N_Gesture_Saint", False),
    ("g_chest", "N_Gesture_Gothic_Loop", False),
    ("g_heart", "N_Gesture_MilkCowOutfit", False),
    ("g_sleepy", "N_Gesture_Sunbed_Loop", False),
    ("g_cover", "N_Gesture_Swimming", False),
    ("g_fight", "N_Gesture_FairyTale_Loop", False),
    ("g_raise", "N_Gesture_Swimming4_Loop", False),
    ("g_fidget", "N_Gesture_Patissier_Start", False),
    ("g_explain", "N_Gesture_Servant", False),
]


# ---------------------------------------------------------------- 수학
def quat_to_mat(q):
    x, y, z, w = q
    n = x * x + y * y + z * z + w * w
    s = 2.0 / n if n > 0 else 0.0
    xx, yy, zz = x * x * s, y * y * s, z * z * s
    xy, xz, yz = x * y * s, x * z * s, y * z * s
    wx, wy, wz = w * x * s, w * y * s, w * z * s
    return np.array([
        [1 - (yy + zz), xy - wz, xz + wy, 0],
        [xy + wz, 1 - (xx + zz), yz - wx, 0],
        [xz - wy, yz + wx, 1 - (xx + yy), 0],
        [0, 0, 0, 1],
    ], dtype=np.float64)


def compose(pos, q):
    m = quat_to_mat(q)
    m[0:3, 3] = pos
    return m


def mat_to_quat(m):
    t = np.trace(m[:3, :3])
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        w = 0.25 * s
        x = (m[2, 1] - m[1, 2]) / s
        y = (m[0, 2] - m[2, 0]) / s
        z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s
        y = (m[0, 1] + m[1, 0]) / s
        z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s
        y = 0.25 * s
        z = (m[1, 2] + m[2, 1]) / s
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s
        y = (m[1, 2] + m[2, 1]) / s
        z = 0.25 * s
    q = np.array([x, y, z, w])
    return q / np.linalg.norm(q)


def vq(q):
    """Vision 쿼터니언 → three.js/glTF (x,y,z 부호 반전; 위키 뷰어의 vq 와 동일)"""
    return (-q[0], -q[1], -q[2], q[3])


# ---------------------------------------------------------------- 원본 읽기
def ungz(b64):
    return gzip.decompress(base64.b64decode(b64))


def load_part(rel):
    p = os.path.join(ASSETS, *rel.split("/")) + ".model"
    mesh = swmodels.parse_model(p)
    skin = actmode._skin(p)
    if "bones" not in skin:
        raise RuntimeError(f"{rel}: 뼈대/가중치 없음")
    if skin["nv"] != mesh["vcount"]:
        raise RuntimeError(f"{rel}: 정점 수 불일치 mesh={mesh['vcount']} skin={skin['nv']}")
    bi = np.frombuffer(ungz(skin["bi"]), dtype="<u2").reshape(-1, 4)
    bw = np.frombuffer(ungz(skin["bw"]), dtype="u1").reshape(-1, 4).astype(np.float32) / 255.0
    defs = load_material_xml(p)
    return {"rel": rel, "path": p, "mesh": mesh, "bones": skin["bones"], "bi": bi, "bw": bw, "defs": defs}


def resolve_tex(model_rel, diffuse):
    if not diffuse:
        return None
    parts = swmodels._resolve(model_rel.split("/")[:-1], diffuse)
    if not parts:
        return None
    p = os.path.join(ASSETS, *parts)
    return p if os.path.isfile(p) else None


def dds_to_png(path, cache):
    if path in cache:
        return cache[path]
    try:
        im = Image.open(path).convert("RGBA")
    except Exception as e:  # noqa: BLE001
        print("  [텍스처] 읽기 실패:", os.path.basename(path), e)
        cache[path] = None
        return None
    # 단색 흰 텍스처는 색상 인자로 충분하므로 넣지 않는다
    arr = np.asarray(im)
    if arr[..., :3].min() >= 250:
        cache[path] = None
        return None
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    cache[path] = buf.getvalue()
    return cache[path]



# ---------------------------------------------------------------- 게임 셀 셰이더 재질 베이크
import xml.etree.ElementTree as ET  # noqa: E402

TEX_ROOT = ASSETS  # MaskTexture 등 paramstring 경로는 Assets 기준


def _rgba(v, default):
    try:
        a = [float(x) for x in v.split(",")]
        while len(a) < 4:
            a.append(1.0)
        return a[:4]
    except Exception:  # noqa: BLE001
        return list(default)


def load_material_xml(model_path):
    """materials.xml → {재질명: {diffuse, transparency, ds, effect, params{}}} (SWCellShading 파라미터 포함)"""
    p = model_path + "_data" + os.sep + "materials.xml"
    out = {}
    if not os.path.isfile(p):
        return out
    try:
        root = ET.parse(p).getroot()
    except ET.ParseError:
        return out
    for el in root.iter("Material"):
        sh = el.find("Shader")
        params = {}
        if sh is not None:
            for kv in (sh.get("paramstring") or "").split(";"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    params[k.strip()] = v.strip()
        out[el.get("name")] = {
            "diffuse": el.get("diffuse") or "",
            "transparency": el.get("transparency") or "opaque",
            "ds": el.get("doublesided") == "TRUE",
            "effect": (sh.get("effect") if sh is not None else "") or "",
            "params": params,
        }
    return out


def _load_rgba_arr(path, size=None):
    im = Image.open(path).convert("RGBA")
    if size and im.size != size:
        im = im.resize(size, Image.BILINEAR)
    return np.asarray(im).astype(np.float32) / 255.0


def bake_material(model_rel, name, df, cache):
    """게임 셰이더(BodyToon/HairToon/DefaultToon)의 색 합성을 텍스처에 미리 구워 (png bytes|None, rgba color, extras) 를 돌려준다.

    BodyToon : diffuse = lerp(BodyColor, Base, Mask.g) → lerp(·, BoneColor, Mask.r)
    HairToon : diffuse = lerp(HairColor, Base, Mask.g) → lerp(·, HairDarknessColor, Mask.r)
    그 외     : Base 그대로. Base 가 white.dds 면 흰색.
    """
    params = df.get("params", {})
    effect = df.get("effect", "")
    key = (model_rel, name)
    if key in cache:
        return cache[key]
    base_p = resolve_tex(model_rel, df.get("diffuse"))
    base = None
    if base_p and os.path.basename(base_p).lower() != "white.dds":
        try:
            base = _load_rgba_arr(base_p)
        except Exception as e:  # noqa: BLE001
            print("  [텍스처] 읽기 실패:", os.path.basename(base_p), e)
    mask = None
    mp = params.get("MaskTexture")
    if mp and ("Body" in effect or "Hair" in effect):
        mpath = os.path.join(TEX_ROOT, *mp.replace("\\", "/").split("/"))
        if os.path.isfile(mpath):
            try:
                mask = _load_rgba_arr(mpath)
            except Exception as e:  # noqa: BLE001
                print("  [마스크] 읽기 실패:", os.path.basename(mpath), e)
        else:
            print("  [마스크] 없음:", mp)
    size = None
    if base is not None:
        size = base.shape[1::-1]
    if mask is not None:
        msz = mask.shape[1::-1]
        size = msz if size is None else (max(size[0], msz[0]), max(size[1], msz[1]))
    if size is None:
        size = (4, 4)
    if base is None:
        base = np.ones((size[1], size[0], 4), dtype=np.float32)
    elif base.shape[1::-1] != size:
        base = _load_rgba_arr(base_p, size)
    if mask is not None and mask.shape[1::-1] != size:
        mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize(size, Image.BILINEAR)).astype(np.float32) / 255.0

    rgb = base[..., :3]
    if mask is not None and "Body" in effect:
        body = np.array(_rgba(params.get("BodyColor", ""), (1, 1, 1, 1))[:3], dtype=np.float32)
        bone = np.array(_rgba(params.get("BoneColor", ""), body)[:3], dtype=np.float32)
        g = mask[..., 1:2]
        r = mask[..., 0:1]
        rgb = body * (1 - g) + rgb * g
        rgb = rgb * (1 - r) + bone * r
    elif mask is not None and "Hair" in effect:
        hair = np.array(_rgba(params.get("HairColor", ""), (1, 1, 1, 1))[:3], dtype=np.float32)
        dark = np.array(_rgba(params.get("HairDarknessColor", ""), hair)[:3], dtype=np.float32)
        g = mask[..., 1:2]
        r = mask[..., 0:1]
        rgb = hair * (1 - g) + rgb * g
        rgb = rgb * (1 - r) + dark * r
    elif mask is None and "Body" in effect:
        rgb = rgb * np.array(_rgba(params.get("BodyColor", ""), (1, 1, 1, 1))[:3], dtype=np.float32)
    elif mask is None and "Hair" in effect:
        rgb = rgb * np.array(_rgba(params.get("HairColor", ""), (1, 1, 1, 1))[:3], dtype=np.float32)
    out = np.concatenate([rgb, base[..., 3:4]], axis=-1)
    out8 = np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)

    shadow = _rgba(params.get("ShadowColor", ""), (0, 0, 0, 0.25))
    if "Body" in effect:
        shadow = _rgba(params.get("BodyShadowColor", params.get("ShadowColor", "")), shadow)
    rim = _rgba(params.get("RimLightColor", ""), (1, 1, 1, 0))
    extras = {"effect": effect, "shadowColor": [round(x, 4) for x in shadow], "rimAlpha": round(rim[3], 3),
              "outline": float(params.get("OutlineThickness", "0.012") or 0.012)}

    flat = out8.reshape(-1, 4)
    if (flat == flat[0]).all():
        color = [float(x) / 255 for x in flat[0]]
        cache[key] = (None, color, extras)
        return cache[key]
    buf = io.BytesIO()
    Image.fromarray(out8, "RGBA").save(buf, format="PNG", optimize=True)
    cache[key] = (buf.getvalue(), [1.0, 1.0, 1.0, 1.0], extras)
    return cache[key]


# ---------------------------------------------------------------- GLB 조립
class Glb:
    def __init__(self):
        self.bin = bytearray()
        self.views = []
        self.accessors = []
        self.images = []
        self.textures = []
        self.materials = []
        self.meshes = []
        self.skins = []
        self.nodes = []
        self.animations = []
        self.samplers_tex = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]

    def view(self, data, target=None, stride=None):
        while len(self.bin) % 4:
            self.bin += b"\0"
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            v["target"] = target
        if stride:
            v["byteStride"] = stride
        self.bin += data
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, ctype, comp, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        vi = self.view(arr.tobytes(), target)
        a = {"bufferView": vi, "componentType": comp, "count": int(arr.shape[0]), "type": ctype}
        if normalized:
            a["normalized"] = True
        if minmax:
            a["min"] = [float(x) for x in arr.min(axis=0)] if arr.ndim > 1 else [float(arr.min())]
            a["max"] = [float(x) for x in arr.max(axis=0)] if arr.ndim > 1 else [float(arr.max())]
        self.accessors.append(a)
        return len(self.accessors) - 1

    def image_png(self, png):
        vi = self.view(png)
        self.images.append({"bufferView": vi, "mimeType": "image/png"})
        self.textures.append({"sampler": 0, "source": len(self.images) - 1})
        return len(self.textures) - 1

    def write(self, path, scene_nodes, extras):
        doc = {
            "asset": {"version": "2.0", "generator": "vaichat haru-export-glb.py"},
            "scene": 0,
            "scenes": [{"nodes": scene_nodes}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "skins": self.skins,
            "materials": self.materials,
            "accessors": self.accessors,
            "bufferViews": self.views,
            "buffers": [{"byteLength": len(self.bin)}],
            "extras": extras,
        }
        if self.images:
            doc["images"] = self.images
            doc["textures"] = self.textures
            doc["samplers"] = self.samplers_tex
        if self.animations:
            doc["animations"] = self.animations
        js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
        while len(js) % 4:
            js += b" "
        while len(self.bin) % 4:
            self.bin += b"\0"
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(struct.pack("<4sII", b"glTF", 2, total))
            f.write(struct.pack("<I4s", len(js), b"JSON"))
            f.write(js)
            f.write(struct.pack("<I4s", len(self.bin), b"BIN\0"))
            f.write(self.bin)
        return total


def main():
    base_path = actmode.find_model(CODE)
    base_skin = actmode._skin(base_path)
    base_bones = base_skin["bones"]  # [name, parent, local_pos, local_quat, ib_pos, ib_quat]
    print(f"기본 뼈대: {len(base_bones)}개 ({os.path.basename(base_path)})")

    g = Glb()
    # ---- 뼈 노드: 기본 뼈대 순서대로, 부품에만 있는 뼈는 뒤에 덧붙인다
    name_to_node = {}
    bone_bind = {}  # 뼈 이름 → 바인드(월드) 4x4 (Vision 공간)
    root_bone_nodes = []
    for b in base_bones:
        name, par, lpos, lq, ibp, ibq = b
        node = {"name": name, "translation": [float(x) for x in lpos], "rotation": [float(x) for x in vq(lq)]}
        g.nodes.append(node)
        idx = len(g.nodes) - 1
        name_to_node[name.lower()] = idx
        bone_bind[name.lower()] = np.linalg.inv(compose(ibp, vq(ibq)))
        if par >= 0:
            g.nodes[name_to_node[base_bones[par][0].lower()]].setdefault("children", []).append(idx)
        else:
            root_bone_nodes.append(idx)

    parts = []
    for label, rel in PARTS:
        try:
            parts.append((label, load_part(rel)))
        except Exception as e:  # noqa: BLE001
            print(f"  [부품] {label} 건너뜀: {e}")
    # 부품 전용 뼈(헤어 등) 추가: 부품의 바인드 자세에서 부모 기준 상대 변환
    for label, pt in parts:
        for b in pt["bones"]:
            name, par, lpos, lq, ibp, ibq = b
            key = name.lower()
            if key in name_to_node:
                continue
            bind = np.linalg.inv(compose(ibp, vq(ibq)))
            parent_name = pt["bones"][par][0].lower() if par >= 0 else None
            if parent_name and parent_name in bone_bind:
                local = np.linalg.inv(bone_bind[parent_name]) @ bind
            else:
                local = bind
            node = {"name": name, "translation": [float(x) for x in local[0:3, 3]], "rotation": [float(x) for x in mat_to_quat(local)]}
            g.nodes.append(node)
            idx = len(g.nodes) - 1
            name_to_node[key] = idx
            bone_bind[key] = bind
            if parent_name and parent_name in name_to_node:
                g.nodes[name_to_node[parent_name]].setdefault("children", []).append(idx)
            else:
                root_bone_nodes.append(idx)
            print(f"  [뼈 추가] {label}: {name} (부모 {parent_name})")

    # ---- 부품 메시 + 스킨
    tex_cache = {}
    mat_cache = {}
    mesh_nodes = []
    all_pos = []
    for label, pt in parts:
        m = pt["mesh"]
        pos = np.array(m["pos"], dtype=np.float32)
        nrm = np.array(m["nrm"], dtype=np.float32)
        ln = np.linalg.norm(nrm, axis=1, keepdims=True)
        nrm = np.where(ln > 1e-6, nrm / np.maximum(ln, 1e-6), np.array([[0, 0, 1]], dtype=np.float32))
        uv = np.array(m["uv"], dtype=np.float32)
        idx = np.array(m["idx"], dtype=np.uint32)
        all_pos.append(pos)
        # 부품 뼈 → 합친 노드
        joints = [name_to_node[b[0].lower()] for b in pt["bones"]]
        ibms = np.array([compose(b[4], vq(b[5])).T.reshape(16) for b in pt["bones"]], dtype=np.float32)  # 열 우선
        skin = {"name": label, "joints": joints, "inverseBindMatrices": g.accessor(ibms, "MAT4", 5126)}
        g.skins.append(skin)
        skin_i = len(g.skins) - 1

        a_pos = g.accessor(pos, "VEC3", 5126, 34962, minmax=True)
        a_nrm = g.accessor(nrm, "VEC3", 5126, 34962)
        a_uv = g.accessor(uv, "VEC2", 5126, 34962)
        a_j = g.accessor(pt["bi"].astype(np.uint16), "VEC4", 5123, 34962)
        w = pt["bw"].astype(np.float32)
        s = w.sum(axis=1, keepdims=True)
        w = np.where(s > 0, w / np.maximum(s, 1e-6), np.array([[1, 0, 0, 0]], dtype=np.float32))
        a_w = g.accessor(w, "VEC4", 5126, 34962)

        prims = []
        for first, count, mi in m["subs"]:
            if count <= 0:
                continue
            name, embedded = (m["mats"][mi] if mi < len(m["mats"]) else ("", ""))
            df = pt["defs"].get(name, {"diffuse": embedded, "transparency": "opaque", "ds": False, "effect": "", "params": {}})
            png, c, extras = bake_material(pt["rel"], name, df, tex_cache)
            mkey = (pt["rel"], name)
            if mkey not in mat_cache:
                mat = {"name": f"{label}:{name}", "pbrMetallicRoughness": {"baseColorFactor": c, "metallicFactor": 0.0, "roughnessFactor": 1.0},
                       "doubleSided": bool(df.get("ds", False)), "extras": {"part": label, "src": name, **extras}}
                if png:
                    mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": g.image_png(png)}
                tr = df.get("transparency", "opaque")
                if tr.lower() in ("alphatest", "alpha_test"):
                    mat["alphaMode"] = "MASK"
                    mat["alphaCutoff"] = 0.5
                elif tr.lower() not in ("opaque", ""):
                    mat["alphaMode"] = "BLEND"
                g.materials.append(mat)
                mat_cache[mkey] = len(g.materials) - 1
            sub_idx = idx[first:first + count]
            a_i = g.accessor(sub_idx.astype(np.uint32), "SCALAR", 5125, 34963)
            prims.append({"attributes": {"POSITION": a_pos, "NORMAL": a_nrm, "TEXCOORD_0": a_uv, "JOINTS_0": a_j, "WEIGHTS_0": a_w},
                          "indices": a_i, "material": mat_cache[mkey], "mode": 4})
        g.meshes.append({"name": label, "primitives": prims})
        g.nodes.append({"name": f"mesh:{label}", "mesh": len(g.meshes) - 1, "skin": skin_i})
        mesh_nodes.append(len(g.nodes) - 1)
        print(f"  [부품] {label}: 정점 {len(pos)} 삼각형 {len(idx)//3} 재질 {len(prims)} 뼈 {len(joints)}")

    allp = np.concatenate(all_pos)
    print("정점 범위(Vision 공간, 단위 추정용): min", allp.min(axis=0).round(1), "max", allp.max(axis=0).round(1))

    # ---- 애니메이션
    for gname, seq, loop in ANIMS:
        try:
            a = actmode.anim(CODE, seq)
        except Exception as e:  # noqa: BLE001
            print(f"  [애니] {gname}({seq}) 건너뜀: {e}")
            continue
        nb = a["nb"]
        channels, samplers = [], []
        bone_names = a["bones"]
        if "pos" in a:
            t = np.array(a["t"], dtype=np.float32)
            P = np.frombuffer(ungz(a["pos"]), dtype="<f4").reshape(len(t), nb, 3)
        else:
            t, P = None, None
        if "rot" in a:
            tr = np.array(a["tr"], dtype=np.float32)
            R = np.frombuffer(ungz(a["rot"]), dtype="<f4").reshape(len(tr), nb, 4).copy()
            R[..., 0:3] *= -1  # vq
            ln = np.linalg.norm(R, axis=2, keepdims=True)
            R = (R / np.maximum(ln, 1e-8)).astype(np.float32)
        else:
            tr, R = None, None
        # 용량 절감: 프레임 솎기(STEP) + 시간에 따라 변하지 않는 채널은 키 2개로, 바인드 자세와 같으면 생략
        STEP = 2  # 30fps → 15fps
        def thin(times, vals):
            keep = list(range(0, len(times), STEP))
            if keep[-1] != len(times) - 1:
                keep.append(len(times) - 1)
            return times[keep], vals[keep]
        if P is not None:
            t, P = thin(t, P)
        if R is not None:
            tr, R = thin(tr, R)
        a_t = g.accessor(t, "SCALAR", 5126, minmax=True) if t is not None else None
        a_tr = g.accessor(tr, "SCALAR", 5126, minmax=True) if tr is not None else None
        a_t2 = g.accessor(np.array([t[0], t[-1]], dtype=np.float32), "SCALAR", 5126, minmax=True) if t is not None else None
        a_tr2 = g.accessor(np.array([tr[0], tr[-1]], dtype=np.float32), "SCALAR", 5126, minmax=True) if tr is not None else None
        used = dropped = const = 0
        for bi_, bname in enumerate(bone_names[:nb]):
            node = name_to_node.get(bname.lower())
            if node is None:
                continue
            used += 1
            bind_t = np.array(g.nodes[node].get("translation", [0, 0, 0]), dtype=np.float32)
            bind_r = np.array(g.nodes[node].get("rotation", [0, 0, 0, 1]), dtype=np.float32)
            if P is not None:
                v = np.ascontiguousarray(P[:, bi_, :])
                if np.abs(v - v[0]).max() < 1e-3:  # 움직임 없음
                    if np.abs(v[0] - bind_t).max() < 1e-3:
                        dropped += 1
                    else:
                        const += 1
                        samplers.append({"input": a_t2, "output": g.accessor(np.stack([v[0], v[0]]), "VEC3", 5126), "interpolation": "STEP"})
                        channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": "translation"}})
                else:
                    samplers.append({"input": a_t, "output": g.accessor(v, "VEC3", 5126), "interpolation": "LINEAR"})
                    channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": "translation"}})
            if R is not None:
                v = np.ascontiguousarray(R[:, bi_, :])
                # 쿼터니언 q 와 -q 는 같은 회전
                same = np.minimum(np.abs(v - v[0]).max(axis=1), np.abs(v + v[0]).max(axis=1)).max() < 1e-4
                if same:
                    if min(np.abs(v[0] - bind_r).max(), np.abs(v[0] + bind_r).max()) < 1e-4:
                        dropped += 1
                    else:
                        const += 1
                        samplers.append({"input": a_tr2, "output": g.accessor(np.stack([v[0], v[0]]), "VEC4", 5126), "interpolation": "STEP"})
                        channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": "rotation"}})
                else:
                    samplers.append({"input": a_tr, "output": g.accessor(v, "VEC4", 5126), "interpolation": "LINEAR"})
                    channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": "rotation"}})
        g.animations.append({"name": gname, "channels": channels, "samplers": samplers, "extras": {"loop": loop, "src": seq}})
        dur = float(t[-1]) if t is not None else float(tr[-1])
        print(f"  [애니] {gname}: {seq} 뼈 {used}/{nb} 프레임 {len(t) if t is not None else len(tr)} 길이 {dur:.2f}초 (채널 {len(channels)}, 고정 {const}, 생략 {dropped})")

    # ---- 루트: Vision Z-up(cm 추정) → glTF Y-up(m)
    root = {"name": "haru_root", "rotation": [-0.7071068, 0, 0, 0.7071068], "scale": [0.01, 0.01, 0.01],
            "children": root_bone_nodes + mesh_nodes}
    g.nodes.append(root)
    extras = {"character": "하루 에스티아", "source": "SoulWorker PC_A", "animations": {n: {"loop": l, "src": s} for n, s, l in ANIMS}}
    total = g.write(OUT, [len(g.nodes) - 1], extras)
    print(f"완료: {OUT} ({total/1024/1024:.2f} MB)")


if __name__ == "__main__":
    main()
