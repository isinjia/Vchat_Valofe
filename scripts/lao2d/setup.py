"""라스트오리진 2D 일러스트 모델을 유니티로 꺼낼 준비.

5_LAO_Defence 의 검증용 유니티 프로젝트(tools/unity_ref/proj)에 프리팹과 딸린 자원(그림·메시·클립)을
GUID 그대로 복사하고, 추출 스크립트(Lao2D.cs)와 작업 목록(lao2d_jobs.txt)을 넣는다.

사용:
  python scripts/lao2d/setup.py constantia
  "C:/Program Files/Unity/Hub/Editor/6000.0.58f2/Editor/Unity.exe" -batchmode -nographics -quit \
    -projectPath E:/LAO_MINI_GAME/5_LAO_Defence/tools/unity_ref/proj -executeMethod Lao2D.Run -logFile <로그>
  python scripts/lao2d/build.py constantia
"""
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAO_TOOLS = r"E:/LAO_MINI_GAME/5_LAO_Defence/tools"
sys.path.insert(0, LAO_TOOLS)
sys.path.insert(0, os.path.join(LAO_TOOLS, "unity_ref"))
import build_sd as B  # noqa: E402
import setup as REF  # noqa: E402  (copy_asset: 딸린 자원까지 GUID 그대로 복사)

PROJ = os.path.join(LAO_TOOLS, "unity_ref", "proj")

# id → (2D 모델 프리팹, 클립 이름 → 클립 파일 이름 끝부분)
MODELS = {
    "constantia": (
        B.ROOT + "/AssetBundleResource/Character_2D/2DModel_3P_ConstantiaS2_N.prefab",
        {"pose": "_lobby_pose", "idle": "_lobby_idle", "eye": "_lobby_eye", "start": "_lobby_start", "touch": "_lobby_Tep_breast"},
    ),
    "blacklilith": (
        B.ROOT + "/AssetBundleResource/Character_2D/2DModel_3P_BlackLilith_N.prefab",
        {"pose": "_pose", "lobby": "_lobby", "idle": "_idle", "eye": "_eye", "start": "_start", "touch": "_Tep"},
    ),
}


def clips_of(prefab):
    """프리팹의 애니메이터 컨트롤러가 쓰는 클립 경로들"""
    text = open(prefab, encoding="utf-8", errors="ignore").read()
    out = []
    for g in set(re.findall(r"m_Controller: \{fileID: \d+, guid: ([0-9a-f]{32})", text)):
        ctrl = B.guid_index().get(g)
        if not ctrl:
            continue
        ct = open(ctrl, encoding="utf-8", errors="ignore").read()
        for cg in set(re.findall(r"guid: ([0-9a-f]{32})", ct)):
            p = B.guid_index().get(cg)
            if p and p.endswith(".anim"):
                out.append(p)
    return out


def main():
    ids = sys.argv[1:] or list(MODELS)
    os.makedirs(os.path.join(PROJ, "Assets", "Editor"), exist_ok=True)
    shutil.copyfile(os.path.join(HERE, "Lao2D.cs"), os.path.join(PROJ, "Assets", "Editor", "Lao2D.cs"))
    copied, jobs = set(), []
    for uid in ids:
        prefab, want = MODELS[uid]
        pref_rel = REF.copy_asset(prefab, copied)
        anims = clips_of(prefab)
        # 컨트롤러에 안 걸린 클립(pose·eye 등)도 같은 폴더에서 찾는다
        for d in {os.path.dirname(a) for a in anims}:
            anims += [os.path.join(d, f).replace("\\", "/") for f in os.listdir(d) if f.endswith(".anim")]
        spec = []
        for key, suffix in want.items():
            hit = [a for a in anims if a.endswith(suffix + ".anim") or (suffix == "_Tep" and "_Tep" in a)]
            if hit:
                spec.append(key + "=" + REF.copy_asset(hit[0], copied))
        jobs.append("|".join([uid, pref_rel, ";".join(spec)]))
        print(uid, "clips:", [s.split("=")[0] for s in spec])
    with open(os.path.join(PROJ, "lao2d_jobs.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(jobs) + "\n")
    print("assets:", len(copied))


if __name__ == "__main__":
    main()
