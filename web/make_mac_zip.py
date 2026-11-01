"""Package the web edition as a Mac local-network launcher zip."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release" / "mac" / "KI득KI득_mac.zip"
LAUNCHER = """#!/bin/bash
set -e
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  osascript -e 'display dialog "Python 3이 필요합니다. Python 공식 사이트에서 설치한 뒤 다시 실행하세요." buttons {"확인"} default button 1'
  open "https://www.python.org/downloads/"
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
if ! .venv/bin/python -c "import aiohttp, qrcode" >/dev/null 2>&1; then
  .venv/bin/python -m pip install -r web/requirements.txt
fi
exec .venv/bin/python web/local_launcher.py
"""


def add_file(zf, path, archive_name, mode=0o644):
    info = zipfile.ZipInfo(archive_name)
    info.create_system = 3
    info.external_attr = (0o100000 | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    zf.writestr(info, Path(path).read_bytes())


OUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUT, "w") as zf:
    for name in ("web/local_launcher.py", "web/server.py", "web/ranking_store.py", "web/requirements.txt"):
        add_file(zf, ROOT / name, f"KI득KI득/{name}")
    for path in sorted((ROOT / "web" / "static").rglob("*")):
        if path.is_file():
            rel = path.relative_to(ROOT).as_posix()
            add_file(zf, path, f"KI득KI득/{rel}")
    for name in ("Jua-Regular.ttf", "Jua-OFL.txt"):
        add_file(zf, ROOT / "fonts" / name, f"KI득KI득/fonts/{name}")
    info = zipfile.ZipInfo("KI득KI득/로컬 네트워크판 실행.command")
    info.create_system = 3
    info.external_attr = (0o100000 | 0o755) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    zf.writestr(info, LAUNCHER.encode("utf-8"))
print(f"완료: {OUT}")
