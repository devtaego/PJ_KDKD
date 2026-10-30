#!/bin/bash
# 맥에서 Chess.app 만들기
# 사용법: 터미널에서 이 폴더로 이동한 뒤  bash build_mac.sh
# 준비물: python.org에서 받은 Python 3 (tkinter 포함)
set -e
cd "$(dirname "$0")"

python3 -m venv .venv-mac
source .venv-mac/bin/activate
pip install -q pillow pyinstaller

pyinstaller --windowed --noconfirm --name Chess \
  --distpath dist-mac --workpath build-mac --specpath build-mac \
  chess_game.py

echo
echo "완료: $(pwd)/dist-mac/Chess.app"
echo "처음 실행할 때 '확인되지 않은 개발자' 경고가 뜨면 Chess.app을 우클릭 -> 열기"
