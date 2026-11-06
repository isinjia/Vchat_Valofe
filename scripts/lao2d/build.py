"""유니티에서 꺼낸 2D 모델 JSON(Lao2D.cs 결과) → 웹용 파일.

  apps/web/public/lao2d/<id>.json   뼈·부품·클립 (클립은 움직이는 뼈만 남김)
  apps/web/public/lao2d/<id>_*.png  부품 그림

사용: python scripts/lao2d/build.py constantia
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = r"E:/LAO_MINI_GAME/5_LAO_Defence/tools/unity_ref/proj"
OUT = os.path.join(HERE, "..", "..", "apps", "web", "public", "lao2d")


def r4(vs, nd=4):
    return [round(v, nd) for v in vs]


def build(uid):
    d = json.load(open(os.path.join(SRC, "lao2d", uid + ".json"), encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    nodes = [{"n": n["n"], "p": n["p"], "on": n["on"], "t": r4(n["t"], 5), "q": r4(n["q"], 5), "s": r4(n["s"], 4)} for n in d["nodes"]]
    texs = {}
    parts = []
    for p in d["parts"]:
        if not p["tex"]:
            continue  # 그림 없는 부품(빈 재질)은 그리지 않는다
        if p["tex"] not in texs:
            name = "%s_%d.png" % (uid, len(texs))
            shutil.copyfile(os.path.join(SRC, p["tex"]), os.path.join(OUT, name))
            texs[p["tex"]] = name
        q = {
            "node": p["node"], "kind": p["kind"], "on": p["on"], "layer": p["layer"], "order": p["order"],
            "tex": texs[p["tex"]], "color": r4(p["color"], 3),
            "pos": r4(p["pos"], 4), "uv": r4(p["uv"], 5), "idx": p["idx"],
        }
        if "si" in p:
            q.update({"si": p["si"], "sw": r4(p["sw"], 4), "bones": p["bones"], "bind": r4(p["bind"], 5)})
        parts.append(q)
    clips = {}
    n = len(nodes)
    for name, c in d["clips"].items():
        fr = c["frames"]
        tracks = {}
        for i in range(n):
            tr = {}
            for key, w in (("t", 3), ("q", 4), ("s", 3)):
                seq = [f[key][i * w:(i + 1) * w] for f in fr]
                if any(abs(a - b) > 1e-5 for s in seq for a, b in zip(s, seq[0])) or any(
                    abs(a - b) > 1e-5 for a, b in zip(seq[0], nodes[i][key])
                ):
                    tr[key] = [round(v, 5) for s in seq for v in s]
            on = [f["on"][i] for f in fr]
            if len(set(on)) > 1 or on[0] != nodes[i]["on"]:
                tr["on"] = on
            if tr:
                tracks[str(i)] = tr
        clips[name] = {"len": c["len"], "loop": c["loop"], "fps": c["fps"], "frames": len(fr), "tracks": tracks}
    ref = json.load(open(os.path.join(SRC, "lao2d", uid + "_ref.json")))
    out = {"id": uid, "nodes": nodes, "parts": parts, "clips": clips, "view": ref}
    path = os.path.join(OUT, uid + ".json")
    json.dump(out, open(path, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print(uid, "nodes", n, "parts", len(parts), "clips", {k: len(v["tracks"]) for k, v in clips.items()}, "%.0fKB" % (os.path.getsize(path) / 1024))


if __name__ == "__main__":
    for uid in sys.argv[1:] or ["constantia"]:
        build(uid)
