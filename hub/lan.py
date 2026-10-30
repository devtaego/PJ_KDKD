"""같은 와이파이 안에서 서로 찾기 (UDP 방송)

- 방장 PC: 1초마다 "여기 방 있어요"(게임, 방장 이름, 인원, 상태)를 알림
- 게임룸 첫 화면: 2초마다 "나 여기 있어요"(닉네임, 한 줄 소개, 내 기록)를 알림 -> 우리 반 랭킹
- 모두가 같은 포트에서 듣고 모아 둠. IP를 몰라도 방 목록에서 바로 참가할 수 있게.
"""
import json
import socket
import threading
import time

PORT = 50010
APP_TAG = "kidk1"
MAX_PACKET = 8000
ROOM_TTL = 3.5  # 이 시간 동안 소식이 없으면 방이 사라진 것으로
PEOPLE_TTL = 7.0

_lock = threading.Lock()
_rooms = {}  # (ip, game) -> 방 정보
_people = {}  # 닉네임 -> {ip, intro, records, t}
_started = False


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # 실제로 보내지는 않음 (내 IP 확인용)
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def _targets():
    ip = local_ip()
    out = {"255.255.255.255", "127.0.0.1"}
    if ip.count(".") == 3 and not ip.startswith("127."):
        out.add(ip.rsplit(".", 1)[0] + ".255")  # 같은 공유기 (/24 가정)
    return out


def send(msg):
    """한 번 알리기 (실패해도 조용히)."""
    data = json.dumps({"app": APP_TAG, **msg}, ensure_ascii=False).encode("utf-8")
    if len(data) > MAX_PACKET:
        return
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for t in _targets():
            try:
                s.sendto(data, (t, PORT))
            except OSError:
                pass
    finally:
        s.close()


def parse(data, ip):
    """받은 소식 검사: 이상하면 None."""
    try:
        msg = json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(msg, dict) or msg.get("app") != APP_TAG:
        return None
    kind = msg.get("kind")
    if kind == "room":
        game = msg.get("game")
        if not isinstance(game, str) or len(game) > 12:
            return None
        return {"kind": "room", "ip": ip, "game": game, "host": str(msg.get("host", "?"))[:12],
                "players": int(msg.get("players", 1)) if str(msg.get("players", 1)).isdigit() else 1,
                "max": int(msg.get("max", 2)) if str(msg.get("max", 2)).isdigit() else 2,
                "specs": int(msg.get("specs", 0)) if str(msg.get("specs", 0)).isdigit() else 0,
                "playing": bool(msg.get("playing"))}
    if kind == "who":
        name = str(msg.get("name", "")).strip()[:12]
        if not name:
            return None
        recs = {}
        for game, r in (msg.get("records") or {}).items() if isinstance(msg.get("records"), dict) else []:
            if isinstance(r, dict):
                try:
                    recs[str(game)[:12]] = {"wins": max(int(r.get("wins", 0)), 0),
                                            "games": max(int(r.get("games", 0)), 0)}
                except (TypeError, ValueError):
                    pass
        return {"kind": "who", "ip": ip, "name": name, "intro": str(msg.get("intro", ""))[:30], "records": recs}
    return None


def _listen():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("", PORT))
    except OSError:
        return  # 이미 다른 프로그램이 쓰는 중이면 목록 기능만 끔
    while True:
        try:
            data, (ip, _) = s.recvfrom(MAX_PACKET + 100)
        except OSError:
            time.sleep(0.5)
            continue
        msg = parse(data, ip)
        if not msg:
            continue
        now = time.monotonic()
        with _lock:
            if msg["kind"] == "room":
                _rooms[(ip, msg["game"])] = {**msg, "t": now}
            else:
                _people[msg["name"]] = {**msg, "t": now}


def start():
    """한 번만: 듣기 시작."""
    global _started
    if not _started:
        _started = True
        threading.Thread(target=_listen, daemon=True).start()


def rooms(game=None):
    """지금 열려 있는 방 목록 (최근에 소식이 온 것만). 내 PC의 방은 한 번만."""
    now = time.monotonic()
    me = local_ip()
    with _lock:
        alive = {k: r for k, r in _rooms.items() if now - r["t"] < ROOM_TTL}
    out = []
    for (ip, g), r in alive.items():
        if ip == "127.0.0.1" and (me, g) in alive:
            continue  # 같은 방이 진짜 IP로도 왔음
        if game and g != game:
            continue
        out.append(dict(r))
    return sorted(out, key=lambda r: (r["playing"], r["host"]))


def people():
    now = time.monotonic()
    with _lock:
        return {n: p for n, p in _people.items() if now - p["t"] < PEOPLE_TTL}


class Beacon:
    """주기적으로 알리기. info()가 None을 돌려주면 그 차례는 건너뜀."""

    def __init__(self, info, every=1.0):
        self.info, self.every = info, every
        self.alive = True
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while self.alive:
            try:
                msg = self.info()
                if msg:
                    send(msg)
            except Exception:
                pass
            time.sleep(self.every)

    def stop(self):
        self.alive = False
