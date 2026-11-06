# -*- coding: utf-8 -*-
"""
하루(PC_A) 코스튬 → 코스튬마다 GLB 하나 (apps/web/public/haru/costume/<세트>.glb) + 목록 costumes.json.

- 하루 기본 모델 내보내기(scripts/haru-export-glb.py)를 그대로 불러 부품 목록만 코스튬 부품으로 바꿔 쓴다.
  뼈대는 기본 뼈대 그대로라, 웹에서 코스튬 메시를 하루 뼈대에 다시 묶어 입힌다.
- 코스튬 부품: 상의(Costume01)·하의(Costume02)·다리(Costume03)·신발(Shoes)·장갑(Glove)·한 벌(Suit)·꼬리(Tail).
  머리 장식·가면·소품(Obj)·등 장식(Back)은 뺀다 (앉아 방송하는 화면에서 의자·머리와 겹침).

실행: PYTHONIOENCODING=utf-8 python -I -X utf8 scripts/haru-costume-export.py [세트 이름 ...]
"""
import glob
import importlib.util
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
spec = importlib.util.spec_from_file_location("haru_export", os.path.join(ROOT, "scripts", "haru-export-glb.py"))
hx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hx)

OUT_DIR = os.path.join(ROOT, "apps", "web", "public", "haru", "costume")
EQ_DIR = os.path.join(hx.ASSETS, "Item", "Equipment", "PC_A")
# 부품 종류 (파일 이름 끝) → 웹에서 어떤 기본 부품을 가릴지
SLOTS = {
    "Costume01": "top",  # 상의 → 기본 몸(나시)을 가림
    "Costume02": "bottom",  # 하의 → 기본 하의(반바지)를 가림
    "Costume03": "legs",  # 다리(스타킹 등)
    "Shoes": "shoes",  # 신발 → 기본 발을 가림
    "Shose": "shoes",
    "Glove": "gloves",  # 장갑 → 기본 손을 가림
    "Suit": "suit",  # 한 벌 → 몸·하의를 가림
    "Suit_Lower": "suitLower",
    "Tail": "tail",
}


def slot_of(name):
    m = re.match(r"PC_A_EQ_[^_]+_(.+?)(_\d+)?$", name)
    if not m:
        return None
    rest = m.group(1)
    for k, v in SLOTS.items():
        if rest.lower() == k.lower() or rest.lower().startswith(k.lower() + "_"):
            return v
    return None


def find_sets():
    sets = {}
    for p in glob.glob(os.path.join(EQ_DIR, "**", "PC_A_EQ_*.model"), recursive=True):
        name = os.path.splitext(os.path.basename(p))[0]
        m = re.match(r"PC_A_EQ_([^_]+)_", name)
        if not m:
            continue
        slot = slot_of(name)
        if not slot:
            continue
        rel = os.path.relpath(os.path.splitext(p)[0], hx.ASSETS).replace("\\", "/")
        sets.setdefault(m.group(1), []).append((slot, rel))
    # 상의나 한 벌이 있는 세트만 (신발·장갑만 있는 것은 코스튬이라 하기 어려움)
    return {k: v for k, v in sets.items() if any(s in ("top", "suit") for s, _ in v)}


def korean_names():
    """위키 아이템 자료에서 '[해적의 로망] 해적 상의' 같은 이름의 대괄호 안을 세트 이름으로"""
    names = {}
    pat = re.compile(r'"t":"(?:\[EV\])?\[([^\]]+)\][^"]*","sub":"[^"]*","ic":"img/Icon/Item/Costume/PC_A/PC_A_EQ_([^_"]+)_(?:Costume0[123]|Suit|Shoes|Glove)')
    for f in glob.glob(os.path.join(hx.SW_WIKI, "data", "d", "item", "*.js")):
        for m in pat.finditer(open(f, encoding="utf-8").read()):
            if len(m.group(1)) > 1 and m.group(1).isprintable():
                names.setdefault(m.group(2), m.group(1))
    return names


def icon_of(name, parts):
    import shutil
    for slot in ("top", "suit"):
        for s, rel in parts:
            if s != slot:
                continue
            src = os.path.join(hx.SW_WIKI, "img", "Icon", "Item", "Costume", "PC_A", os.path.basename(rel) + ".png")
            if os.path.exists(src):
                shutil.copyfile(src, os.path.join(OUT_DIR, f"{name}.png"))
                return f"{name}.png"
    return None


# 위키에 이름이 없는 코스튬은 영어 이름을 옮겨 붙인다
FALLBACK = {
    "DarkArbiter": "다크 아비터", "GoldArbiter": "골드 아비터", "PlatinumArbiter": "플래티넘 아비터",
    "Gatcha1": "뽑기 의상 1", "Gatcha2": "뽑기 의상 2", "Maidswimsuits": "메이드 수영복", "ModernCasual2": "모던 캐쥬얼 2",
    "NormalTop1": "기본 상의 1", "NormalTop2": "기본 상의 2", "NormalTop3": "기본 상의 3", "Rider": "라이더", "Rider2": "라이더 2",
    "RuinReward": "폐허 보상 의상", "Shirt": "셔츠", "Spring2": "스프링 룩 2", "Sweater": "스웨터", "UserT1": "티셔츠 1",
    "UserT2": "티셔츠 2", "ZippHood": "지퍼 후드", "jacket": "재킷",
}


def fix_names(listing, kor):
    seen = {}
    for k in sorted(listing):
        n = kor.get(k) or FALLBACK.get(k) or k
        if n in seen.values():
            n += " (다른 색)"  # BlissfulWinterB 처럼 같은 이름의 다른 색
        seen[k] = n
        listing[k]["name"] = n


def rename_only():
    """GLB 는 그대로 두고 목록의 이름만 다시 채운다"""
    kor = korean_names()
    path = os.path.join(OUT_DIR, "costumes.json")
    listing = json.load(open(path, encoding="utf-8"))
    fix_names(listing, kor)
    json.dump(listing, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


# ---------------------------------------------------------------- 장식 부품 하나씩 (--items)
ITEM_DIR = os.path.join(OUT_DIR, "items")
# 파일 이름 끝(소문자) → 종류
ITEM_CATS = [
    ("hair", r"^(48_)?hair_(29|32|01)$"),
    ("hat", r"^(haircap_02|hatmask_31)$"),
    ("mask", r"^haircapeye_19$"),
    ("hairAcc", r"^(100_)?hairacc0[12](_0?1|_16)?$"),
    ("ear", r"^earacc_92$"),
    ("eye", r"^(eyeacc(01)?_03|eyepatch_34)$"),
    ("mouth", r"^mouthacc_04(_1)?$"),
    ("faceAcc", r"^eyemouth_18$"),
    ("face", r"^face(_02)?$"),
    ("back", r"^((mayo|ketchup)_)?back_10$"),
    ("tail", r"^tail_13$"),
]
# 게임 기본 다른 머리 모양
DEFAULT_HAIRS = ["Character/Player/PC_A/PC_A_Parts_Default_Hair_02", "Character/Player/PC_A/PC_A_Parts_Default_Hair_03"]


def item_cat(name):
    m = re.match(r"PC_A_EQ_[^_]+_(.+)$", name)
    if not m:
        return None
    rest = m.group(1).lower()
    for cat, pat in ITEM_CATS:
        if re.match(pat, rest):
            return cat
    return None


def item_names():
    names = {}
    pat = re.compile(r'"t":"(?:\[EV\])?([^"]+)","sub":"[^"]*","ic":"img/Icon/Item/Costume/PC_A/(PC_A_EQ_[^".]+)\.png"')
    for f in glob.glob(os.path.join(hx.SW_WIKI, "data", "d", "item", "*.js")):
        for m in pat.finditer(open(f, encoding="utf-8").read()):
            n = m.group(1).strip()
            if len(n) > 1 and n.isprintable():  # 위키 자리 표시("\1")는 건너뜀
                names.setdefault(m.group(2), n)
    return names


CAT_LABEL = {"hair": "헤어", "hat": "모자", "mask": "인형탈", "hairAcc": "머리 장식", "ear": "귀걸이", "eye": "눈 장식",
             "mouth": "입 장식", "faceAcc": "얼굴 장식", "face": "얼굴", "back": "등 장식", "tail": "허리 장식"}


def export_items():
    import shutil
    os.makedirs(ITEM_DIR, exist_ok=True)
    names = item_names()
    kor = korean_names()
    items = []
    for p in glob.glob(os.path.join(EQ_DIR, "**", "PC_A_EQ_*.model"), recursive=True):
        base = os.path.splitext(os.path.basename(p))[0]
        cat = item_cat(base)
        if cat:
            items.append((cat, base, os.path.relpath(os.path.splitext(p)[0], hx.ASSETS).replace("\\", "/")))
    for i, rel in enumerate(DEFAULT_HAIRS):
        items.append(("hair", os.path.basename(rel), rel))
    listing = {}
    for cat, base, rel in sorted(items):
        out = os.path.join(ITEM_DIR, base + ".glb")
        if not os.path.exists(out):
            hx.PARTS = [(cat, rel)]
            hx.ANIMS = []
            hx.OUT = out
            try:
                hx.main()
            except Exception as e:  # noqa: BLE001
                print("실패", base, e)
                continue
        icon = None
        src = os.path.join(hx.SW_WIKI, "img", "Icon", "Item", "Costume", "PC_A", base + ".png")
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(ITEM_DIR, base + ".png"))
            icon = "items/" + base + ".png"
        name = names.get(base)
        if not name:
            if base.startswith("PC_A_Parts_Default_Hair"):
                name = "기본 머리 " + base[-1]
            else:
                set_id = re.sub(r"^PC_A_EQ_([^_]+)_.*$", r"\1", base)
                num = re.sub(r"\D", "", set_id)
                name = kor.get(set_id) or (f"얼굴 {int(num)}" if cat == "face" and num else f"{CAT_LABEL.get(cat, cat)} {set_id}")
        listing.setdefault(cat, []).append({"id": base, "name": name, "icon": icon, "file": "items/" + base + ".glb"})
    with open(os.path.join(OUT_DIR, "items.json"), "w", encoding="utf-8") as w:
        json.dump(listing, w, ensure_ascii=False, indent=1)
    print({k: len(v) for k, v in listing.items()})


def main():
    if sys.argv[1:] == ["--names"]:
        rename_only()
        return
    if sys.argv[1:] == ["--items"]:
        export_items()
        return
    os.makedirs(OUT_DIR, exist_ok=True)
    kor = korean_names()
    sets = find_sets()
    want = sys.argv[1:] or sorted(sets)
    listing_path = os.path.join(OUT_DIR, "costumes.json")
    listing = json.load(open(listing_path, encoding="utf-8")) if os.path.exists(listing_path) else {}
    for name in want:
        parts = sets.get(name)
        if not parts:
            print("없음", name)
            continue
        hx.PARTS = [(slot, rel) for slot, rel in sorted(parts)]
        hx.ANIMS = []
        hx.OUT = os.path.join(OUT_DIR, f"{name}.glb")
        try:
            hx.main()
        except Exception as e:  # noqa: BLE001
            print("실패", name, e)
            continue
        listing[name] = {"file": f"{name}.glb", "name": name, "icon": icon_of(name, parts), "slots": sorted({s for s, _ in parts})}
        fix_names(listing, kor)
        with open(listing_path, "w", encoding="utf-8") as w:
            json.dump(listing, w, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
