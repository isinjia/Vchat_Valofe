# -*- coding: utf-8 -*-
"""
하루 방송 방 소품 변환기 — 소울워커 마이룸 가구(.model, 정적) → apps/web/public/haru/room.glb

- 재질 합성·텍스처 처리·GLB 작성은 scripts/haru-export-glb.py 의 함수를 그대로 빌려 쓴다.
- 소품마다 최상위 노드 하나(이름 = 아래 PROPS 의 키). 각 노드는 Vision(Z-up, cm) → glTF(Y-up, m) 변환
  (X축 -90° 회전 + 0.01 배)만 들어 있고 위치는 원점이다. 배치는 웹 쪽(HaruCompanion)에서 한다.
- 벽지·바닥은 50cm 무늬 견본이라 웹 쪽에서 그 텍스처를 큰 면에 반복해 깐다.

실행:  PYTHONIOENCODING=utf-8 python -I -X utf8 scripts/haru-room-export.py   (레포 루트)
"""
import importlib.util
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("haru_export", os.path.join(HERE, "haru-export-glb.py"))
hx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hx)  # type: ignore[union-attr]

OUT = os.path.join(hx.ROOT, "apps", "web", "public", "haru", "room.glb")
OBJ = "Character/Object"

# 키: (모델 경로(Assets 기준, 확장자 제외), 설명)
PROPS = {
    "wallpaper": (f"{OBJ}/MOBJ_30301_CK_WallPaper/MOBJ_30301_CK_WallPaper_A", "쿠키 벽지 견본"),
    "floor": (f"{OBJ}/MOBJ_30302_CK_Floor/MOBJ_30302_CK_Floor_A", "쿠키 바닥 견본"),
    "window": (f"{OBJ}/MOBJ_30305_CK_Window/MOBJ_30305_CK_Window_A", "쿠키 창문"),
    "bed": (f"{OBJ}/MOBJ_30308_CK_Bed/MOBJ_30308_CK_Bed_A", "쿠키 침대"),
    "drawer": (f"{OBJ}/MOBJ_30311_CK_DrawerDevice/MOBJ_30311_CK_DrawerDevice_A", "쿠키 서랍장"),
    "cookie_doll": (f"{OBJ}/MOBJ_30314_CK_PropOne/MOBJ_30314_CK_PropOne_A", "베어젤리 쿠키 인형"),
    "donut": (f"{OBJ}/MOBJ_30315_CK_PropTwo/MOBJ_30315_CK_PropTwo_A", "도넛 쿠키 쿠션"),
    "desk": (f"{OBJ}/MR_desk_a/MR_desk_a", "책상"),
    "chair": (f"{OBJ}/MR_Chair_a/MR_Chair_a", "의자"),
    "haru_doll": (f"{OBJ}/MOBJ_31415_PropTwo/MOBJ_31415_PropTwo", "하루 SD인형"),
    "poster": (f"{OBJ}/MOBJ_10303_BP_WallHanging_H/MOBJ_10303_BP_WallHanging_H", "하루 에스티아 포스터"),
    "shelf": (f"{OBJ}/MOBJ_30803_BL_WallHanging/MOBJ_30803_BL_WallHanging_A", "블록 선반 벽장식"),
    "bookcase": (f"{OBJ}/MR_bookcase_a/MR_bookcase_a", "책장"),
    "teddy": (f"{OBJ}/MR_Teddy_bear/MR_Teddy_bear", "곰인형"),
}


def main():
    g = hx.Glb()
    tex_cache = {}
    top = []
    for key, (rel, desc) in PROPS.items():
        path = os.path.join(hx.ASSETS, *rel.split("/")) + ".model"
        if not os.path.isfile(path):
            print(f"  [없음] {key}: {rel}")
            continue
        try:
            m = hx.swmodels.parse_model(path)
        except Exception as e:  # noqa: BLE001
            print(f"  [실패] {key}: {e}")
            continue
        defs = hx.load_material_xml(path)
        pos = np.array(m["pos"], dtype=np.float32)
        nrm = np.array(m["nrm"], dtype=np.float32)
        ln = np.linalg.norm(nrm, axis=1, keepdims=True)
        nrm = np.where(ln > 1e-6, nrm / np.maximum(ln, 1e-6), np.array([[0, 0, 1]], dtype=np.float32))
        uv = np.array(m["uv"], dtype=np.float32)
        idx = np.array(m["idx"], dtype=np.uint32)
        a_pos = g.accessor(pos, "VEC3", 5126, 34962, minmax=True)
        a_nrm = g.accessor(nrm, "VEC3", 5126, 34962)
        a_uv = g.accessor(uv, "VEC2", 5126, 34962)
        prims = []
        mat_cache = {}
        for first, count, mi in m["subs"]:
            if count <= 0:
                continue
            name, embedded = (m["mats"][mi] if mi < len(m["mats"]) else ("", ""))
            df = defs.get(name, {"diffuse": embedded, "transparency": "opaque", "ds": False, "effect": "", "params": {}})
            if not df.get("diffuse"):
                df = {**df, "diffuse": embedded}
            png, c, extras = hx.bake_material(rel, name, df, tex_cache)
            if name not in mat_cache:
                mat = {"name": f"{key}:{name}",
                       "pbrMetallicRoughness": {"baseColorFactor": c, "metallicFactor": 0.0, "roughnessFactor": 1.0},
                       "doubleSided": bool(df.get("ds", False)), "extras": {"part": key, "src": name, **extras}}
                if png:
                    mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": g.image_png(png)}
                tr = (df.get("transparency") or "opaque").lower()
                if tr in ("alphatest", "alpha_test"):
                    mat["alphaMode"] = "MASK"
                    mat["alphaCutoff"] = 0.5
                elif tr not in ("opaque", ""):
                    mat["alphaMode"] = "BLEND"
                g.materials.append(mat)
                mat_cache[name] = len(g.materials) - 1
            a_i = g.accessor(idx[first:first + count].astype(np.uint32), "SCALAR", 5125, 34963)
            prims.append({"attributes": {"POSITION": a_pos, "NORMAL": a_nrm, "TEXCOORD_0": a_uv},
                          "indices": a_i, "material": mat_cache[name], "mode": 4})
        if not prims:
            print(f"  [빈 모델] {key}")
            continue
        g.meshes.append({"name": key, "primitives": prims})
        g.nodes.append({"name": key, "mesh": len(g.meshes) - 1,
                        "rotation": [-0.7071068, 0, 0, 0.7071068], "scale": [0.01, 0.01, 0.01],
                        "extras": {"desc": desc, "src": rel}})
        top.append(len(g.nodes) - 1)
        mn, mx = pos.min(0), pos.max(0)
        print(f"  [소품] {key:12s} {desc}: 정점 {len(pos)} 재질 {len(prims)} 크기(cm) {np.round(mx - mn, 0)}")
    total = g.write(OUT, top, {"props": list(PROPS.keys())})
    print(f"완료: {OUT} ({total / 1024 / 1024:.2f} MB)")


if __name__ == "__main__":
    main()
