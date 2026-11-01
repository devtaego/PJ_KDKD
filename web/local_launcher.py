"""Start the web edition on this computer and share it with the local network."""
import ipaddress
import os
import socket
import sys
import webbrowser
from pathlib import Path


def _runtime_root():
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))


ROOT = _runtime_root()
WEB_DIR = ROOT / "web"
sys.path.insert(0, str(WEB_DIR))

# The LAN edition keeps its ranking on this computer and never uses online secrets.
DATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "KDKD"
DATA_DIR.mkdir(parents=True, exist_ok=True)
os.environ["KIDK_RANKING_FILE"] = str(DATA_DIR / "ranking.json")
os.environ.pop("SUPABASE_URL", None)
os.environ.pop("SUPABASE_SERVICE_KEY", None)

import server  # noqa: E402


def lan_address():
    """Choose the IPv4 address Windows/macOS routes from for other LAN devices."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 9))  # TEST-NET address; UDP connect sends no packet
        candidate = probe.getsockname()[0]
        if not ipaddress.ip_address(candidate).is_loopback:
            return candidate
    except OSError:
        pass
    finally:
        probe.close()

    for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
        candidate = item[4][0]
        address = ipaddress.ip_address(candidate)
        if address.is_private and not address.is_loopback and not address.is_link_local:
            return candidate
    return "127.0.0.1"


def main():
    port = int(os.environ.get("KIDK_PORT", "8000"))
    host = lan_address()
    url = f"http://{host}:{port}"
    app = server.make_app()

    async def announce(_app):
        print("\nKI득KI득 로컬 네트워크판이 실행 중입니다.", flush=True)
        print(f"이 컴퓨터: {url}", flush=True)
        print(f"같은 Wi-Fi 친구에게 공유할 주소: {url}", flush=True)
        print("Windows 방화벽이 물으면 개인 네트워크 접근을 허용하세요.", flush=True)
        print("서버를 종료하려면 이 창에서 Ctrl+C를 누르세요.\n", flush=True)
        if os.environ.get("KIDK_NO_BROWSER") != "1":
            webbrowser.open(url)

    app.on_startup.append(announce)
    server.web.run_app(app, host=host, port=port)


if __name__ == "__main__":
    main()
