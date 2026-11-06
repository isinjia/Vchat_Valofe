"""
하루 말 아닌 소리(웃음·한숨·흠·놀람 등)를 녹음 조각에서 잘라 apps/web/public/haru/sfx 로 내보낸다.
녹음 조각은 하루 음성 작업 폴더(E:\\haru_tts\\data 의 seg·dialog·gesture)에 있고, 받아 적은 글로 골랐다.
앞뒤 무음을 자르고 크기를 맞춰 mp3 로 저장한다. 목록은 sfx.json (종류 → 파일 이름들).

실행: PYTHONIOENCODING=utf-8 python -I -X utf8 scripts/haru-sfx-export.py
"""
import json
import os
import subprocess
import sys

SRC = r"E:\haru_tts\data"
FFMPEG = r"E:\haru_tts\ffmpeg\bin\ffmpeg.exe"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "apps", "web", "public", "haru", "sfx")

# 종류 → [(원본 파일, 시작초, 끝초)] — 받아 적은 글: 괄호 안
SFX = {
    "laugh": [  # 소리 내 웃음
        ("04_58_0002", None, None),  # 아하하하하
        ("028_PC_A_Pirate_N_Laugh_Vox_01", None, None),  # 하하하하
        ("04_99_0011", None, None),  # 하하!
        ("04_99_0008", None, None),  # 하핫!
    ],
    "giggle": [  # 작게 킥킥
        ("04_23_0002", None, None),  # 흐흐
        ("04_29_0000", None, None),  # 흐흐
        ("04_94_0011", None, None),  # 흐흐
        ("04_101_0029", None, None),  # 흐흐흐
        ("04_13_0002", None, None),  # 히히
        ("KR_A_Gothic_Vox", None, None),  # 흐흐
        ("A_Hestia_Vox_Re3", None, None),  # ㅎㅎㅎㅎ
        ("PC_A_Patissier_End_VOX", 0.72, 1.46),  # 흐흐흐
        # 아래는 처음 받아 적을 때 글이 비었던 조각 (하품·숨소리 쪽으로 유도해 다시 받아 적음)
        ("04_56_0000", None, None),  # 으흐흐흐
        ("04_56_0001", None, None),  # 흐하하
        ("04_75_0001", None, None),  # 흐흐흐
        ("04_77_0000", None, None),  # 흐흐흐
        ("04_92_0002", None, None),  # 흐흐흐
        ("04_49_0002", None, None),  # 흐흐흐
        ("04_02_0808", None, None),  # 흐흐흐
        ("04_58_0001", None, None),  # 으흐흐흐흐흐 (길게)
    ],
    "shyLaugh": [  # 수줍은 웃음
        ("KR_CinemaTalk_GraceCity_FrontLine_EP_3_PC_A_Soulumsword_02", None, None),  # 으헤헤헤헤헤
        ("PC_A_N_Gesture_Spiral_01_VO_KR", 0.0, 2.0),  # 으헤헤
        # 04_02_0821 "으흐흐흐흐흐흐흐" 는 길고 음흉하게 들려 뺌 (사용자 지적)
        ("04_101_0089", None, None),  # 흐헤헤헤헤
    ],
    "sigh": [  # 한숨
        ("04_05_0003", None, None),  # 하아...
        ("04_19_0003", None, None),  # 하아...
        ("04_68_0003", None, None),  # 하아...
        ("KR_CinemaTalk_CandusCity_Concretejungle_EP_4_PC_A_Soulumsword_01", None, None),  # 하아...
        ("KR_CinemaTalk_GraceCity_NEDCompany_EP_4_PC_A_Soulumsword_01", None, None),  # 하아...
        ("04_54_0000", None, None),  # 후우
        ("04_02_0112", None, None),  # 후우...
    ],
    "hmm": [  # 생각하는 "흠"
        ("04_13_0003", None, None),  # 흠
        ("04_55_0000", None, None),  # 흠
        ("04_51_0003", None, None),  # 흠...
        ("04_53_0002", None, None),  # 흠...
        ("04_16_0004", None, None),  # 흐음
        ("04_02_0820", None, None),  # 흐음
        ("04_13_0006", None, None),  # 으흠...
        ("04_15_0003", None, None),  # 으흠...
        ("A_Hestia_Vox_Re2", None, None),  # 으음
        ("04_46_0000", None, None),  # 흐음 흐음
        ("04_50_0002", None, None),  # 흐음 흐음
        ("04_76_0001", None, None),  # 흐음
        ("04_92_0001", None, None),  # 흐음 흐음
        ("04_73_0002", None, None),  # 흐음
        ("04_22_0002", None, None),  # 흐음
    ],
    # 하품: 글 없는 조각을 하품 쪽으로 유도해 받아 적어 고른 3개는 실제로는 우는 소리여서 뺐다 (사용자 지적)
    "hum": [  # 콧노래·흥얼거림
        ("04_48_0002", None, None),  # 흐음. 흐음. 흐음. 흐음.
        ("04_91_0000", None, None),  # 음~~
        ("04_21_0003", None, None),  # 음~~
        ("04_47_0002", None, None),  # (흥얼)
    ],
    "surprise": [  # 놀람
        ("04_02_0630", None, None),  # 헉!
        ("04_02_0437", None, None),  # 헉!
        ("04_07_0000", None, None),  # 헉!
        ("04_02_0141", None, None),  # 어?
        ("04_04_0000", None, None),  # 어?
        ("04_02_0146", None, None),  # 오?
    ],
    "huff": [  # 삐짐 "흥"
        ("04_73_0000", None, None),
        ("04_73_0001", None, None),
        ("04_77_0001", None, None),
    ],
    "sob": [  # 흐느낌
        ("04_85_0003", None, None),  # 흑
        ("04_85_0002", None, None),  # 흑... 흑...
    ],
    "cheer": [  # 환호
        ("PC_A_Gesture_Cheer_01_Vox", 0.0, 0.6),  # 워후!
        ("04_24_0002", None, None),  # 우와
    ],
    "wow": [  # 감탄
        ("04_26_0002", None, None),  # 와...
        ("04_28_0002", None, None),  # 와...
        ("04_05_0002", None, None),  # 오...
    ],
    "effort": [  # 영차 (자세 고쳐 앉기·목 풀기)
        ("PC_A_Gesture_Sit_End_02_Vox", 0.0, 2.0),  # 으쌰
        ("PC_A_Gesture_Sit_End_01_Vox", 0.0, 2.0),  # 잇챠아
    ],
}


def find(name):
    for d in ("seg", "dialog", "gesture"):
        p = os.path.join(SRC, d, name + ".wav")
        if os.path.exists(p):
            return p
    return None


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for kind, items in SFX.items():
        files = []
        for i, (name, a, b) in enumerate(items):
            src = find(name)
            if not src:
                print("없음", name)
                continue
            dst = f"{kind}_{i + 1}.mp3"
            cmd = [FFMPEG, "-y", "-loglevel", "error"]
            if a is not None:
                cmd += ["-ss", str(a)]
            if b is not None:
                cmd += ["-to", str(b)]
            cmd += ["-i", src, "-ac", "1", "-af",
                    # 앞뒤 무음 자르기 → 크기 맞추기 → 끝을 살짝 줄여 툭 끊기지 않게
                    "silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.03,"
                    "areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.08,areverse,"
                    "loudnorm=I=-20:TP=-2:LRA=11,afade=t=in:d=0.02",
                    "-ar", "44100", "-b:a", "96k", os.path.join(OUT, dst)]
            subprocess.run(cmd, check=True)
            files.append(dst)
        manifest[kind] = files
        print(kind, len(files))
    with open(os.path.join(OUT, "sfx.json"), "w", encoding="utf-8") as w:
        json.dump(manifest, w, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
