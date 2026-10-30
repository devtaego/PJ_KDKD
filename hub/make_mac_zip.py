"""맥에서 더블클릭으로 실행할 수 있는 KI득KI득_mac.zip 만들기

실행: python hub/make_mac_zip.py  ->  hub/dist/KI득KI득_mac.zip
zip 안의 'KI득KI득 실행.command'에 실행 권한을 넣어 두므로 Windows에서 만들어도 맥에서 바로 더블클릭됨
"""
import os
import zipfile

LAUNCHER = """#!/bin/bash
# 더블클릭하면 KI득KI득 실행
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  osascript -e 'display dialog "Python 3이 필요합니다. 열리는 페이지에서 설치한 뒤 다시 실행하세요." buttons {"확인"} default button 1'
  open "https://www.python.org/downloads/"
  exit 1
fi
# 매끈한 체스 기물용 Pillow (설치 실패해도 게임은 실행됨)
python3 -c "import PIL" 2>/dev/null || python3 -m pip install --user -q pillow 2>/dev/null || true
python3 game_room.py
"""

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
out_dir = os.path.join(here, "dist")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "KI득KI득_mac.zip")


def add(zf, name, data, mode):
    info = zipfile.ZipInfo("KI득KI득/" + name)
    info.create_system = 3  # 유닉스 권한 정보를 맥이 읽도록
    info.external_attr = (0o100000 | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    zf.writestr(info, data)


with zipfile.ZipFile(out, "w") as zf:
    for path in (os.path.join(here, "game_room.py"), os.path.join(root, "chess", "chess_game.py"),
                 os.path.join(root, "yacht", "yacht_game.py"), os.path.join(root, "omok", "omok_game.py")):
        with open(path, "rb") as f:
            add(zf, os.path.basename(path), f.read(), 0o644)
    proj = os.path.dirname(here)
    for fname in ("Jua-Regular.ttf", "Jua-OFL.txt"):  # 앱 글씨체 (주아체, SIL OFL)
        with open(os.path.join(proj, "fonts", fname), "rb") as f:
            add(zf, "fonts/" + fname, f.read(), 0o644)
    for fname in ("avatars.py", "party.py", "chat.py", "ui_kit.py"):  # 프로필 그림, 결과 화면 멘트/티배깅, 채팅/스티커
        with open(os.path.join(here, fname), "rb") as f:
            add(zf, fname, f.read(), 0o644)
    add(zf, "KI득KI득 실행.command", LAUNCHER.encode("utf-8"), 0o755)
print("완료:", out)
