"""맥에서 더블클릭으로 실행할 수 있는 omok_mac.zip 만들기

실행: python omok/make_mac_zip.py  ->  omok/dist/omok_mac.zip
zip 안의 '오목 실행.command'에 실행 권한을 넣어 두므로 Windows에서 만들어도 맥에서 바로 더블클릭됨
"""
import os
import zipfile

LAUNCHER = """#!/bin/bash
# 더블클릭하면 오목 게임 실행
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  osascript -e 'display dialog "Python 3이 필요합니다. 열리는 페이지에서 설치한 뒤 다시 실행하세요." buttons {"확인"} default button 1'
  open "https://www.python.org/downloads/"
  exit 1
fi
# 광택 있는 돌 그림용 Pillow (설치 실패해도 게임은 실행됨)
python3 -c "import PIL" 2>/dev/null || python3 -m pip install --user -q pillow 2>/dev/null || true
python3 omok_game.py
"""

here = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.join(here, "dist")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "omok_mac.zip")


def add(zf, name, data, mode):
    info = zipfile.ZipInfo("omok/" + name)
    info.create_system = 3  # 유닉스 권한 정보를 맥이 읽도록
    info.external_attr = (0o100000 | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    zf.writestr(info, data)


with zipfile.ZipFile(out, "w") as zf:
    with open(os.path.join(here, "omok_game.py"), "rb") as f:
        add(zf, "omok_game.py", f.read(), 0o644)
    with open(os.path.join(os.path.dirname(here), "hub", "ui_kit.py"), "rb") as f:  # 둥근 카드/버튼, 배경
        add(zf, "ui_kit.py", f.read(), 0o644)
    with open(os.path.join(os.path.dirname(here), "hub", "sound.py"), "rb") as f:  # 효과음
        add(zf, "sound.py", f.read(), 0o644)
    proj = os.path.dirname(here)
    for fname in ("Jua-Regular.ttf", "Jua-OFL.txt"):  # 앱 글씨체 (주아체, SIL OFL)
        with open(os.path.join(proj, "fonts", fname), "rb") as f:
            add(zf, "fonts/" + fname, f.read(), 0o644)
    add(zf, "오목 실행.command", LAUNCHER.encode("utf-8"), 0o755)
print("완료:", out)
