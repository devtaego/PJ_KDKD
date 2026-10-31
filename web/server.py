"""KI득KI득 웹 서버: 웹 화면(static/)을 보내 주고, 방 만들기 · 참가 · 채팅 · 게임 수를 웹소켓으로 이어 줌.

게임 규칙은 브라우저마다 똑같이 계산하고, 서버는 '누가 어떤 순서로 무엇을 했는지'만 정해서 모두에게 보냄.
(데스크톱판의 '방장 PC' 역할을 서버가 대신해서, 다른 와이파이 · 폰끼리도 같이 할 수 있음)

실행: pip install -r web/requirements.txt  →  python web/server.py  →  http://localhost:8000
"""
import asyncio
import json
import os
import random
import secrets
import time

from aiohttp import WSMsgType, web

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
FONTS = os.path.join(os.path.dirname(HERE), "fonts")
RANKING_FILE = os.environ.get("KIDK_RANKING_FILE", os.path.join(HERE, "ranking.json"))

GAMES = {"chess": 2, "omok": 2, "yacht": 6}  # 게임 -> 최대 플레이어 수
MAX_MSG = 200_000  # 메시지 하나 최대 크기 (프로필 사진 포함해도 충분)
MAX_PHOTO = 60_000
MAX_TEXT = 100
MAX_LOG = 5000
GRACE = 30  # 연결이 끊긴 사람의 자리를 지켜 주는 시간(초)
ROOM_ADJ = ["용감한", "졸린", "신나는", "수줍은", "배고픈", "반짝이는", "느긋한", "씩씩한", "엉뚱한", "다정한"]
ROOM_ANIMAL = ["판다", "여우", "토끼", "곰돌이", "병아리", "개구리", "고양이", "돼지", "펭귄", "다람쥐"]
ANIMALS = {"cat", "bear", "rabbit", "frog", "chick", "pig", "panda", "fox"}
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 헷갈리는 0/O, 1/I 뺌


def now_ms():
    return int(time.time() * 1000)


def clean_text(s, limit):
    return " ".join(str(s or "").split())[:limit]


def clean_profile(p):
    """닉네임 · 프로필 · 한 줄 소개만 받아서 길이를 자름. 이상한 값이면 None."""
    if not isinstance(p, dict):
        return None
    name = clean_text(p.get("name"), 12)
    if not name:
        return None
    av = p.get("avatar")
    if isinstance(av, str) and av in ANIMALS:
        avatar = av
    elif isinstance(av, str) and av.startswith("data:image/") and len(av) <= MAX_PHOTO:
        avatar = av
    else:
        avatar = "cat"
    return {"name": name, "avatar": avatar, "intro": clean_text(p.get("intro"), 30)}


class Client:
    def __init__(self, cid):
        self.cid = cid
        self.ws = None
        self.profile = None
        self.room = None
        self.gone_at = None  # 연결이 끊긴 시각 (다시 들어오면 None)

    async def send(self, obj):
        if self.ws is not None and not self.ws.closed:
            try:
                await self.ws.send_str(json.dumps(obj, ensure_ascii=False))
            except (ConnectionResetError, RuntimeError):
                pass


class Room:
    def __init__(self, rid, game, settings, host):
        self.id = rid
        self.game = game
        self.settings = settings
        self.name = f"{random.choice(ROOM_ADJ)} {random.choice(ROOM_ANIMAL)} 방"
        self.host = host
        self.members = []  # [cid, role] 들어온 순서대로. role: player / spectator
        self.status = "waiting"  # waiting / playing / done
        self.log = []  # 이번 판의 수 (늦게 들어온 사람과 재접속한 사람이 다시 계산하는 재료)
        self.seq = 0

    def players(self):
        return [cid for cid, role in self.members if role == "player"]

    def role_of(self, cid):
        for c, role in self.members:
            if c == cid:
                return role
        return None


class Hub:
    def __init__(self):
        self.clients = {}
        self.rooms = {}
        self.ranking = self.load_ranking()

    # ------------------------------------------------------------ 랭킹
    @staticmethod
    def load_ranking():
        try:
            with open(RANKING_FILE, encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def save_ranking(self):
        try:
            with open(RANKING_FILE, "w", encoding="utf-8") as f:
                json.dump(self.ranking, f, ensure_ascii=False)
        except OSError:
            pass

    def add_result(self, game, players, winners):
        for name in players:
            rec = self.ranking.setdefault(name, {}).setdefault(game, {"wins": 0, "games": 0})
            rec["games"] += 1
            if name in winners:
                rec["wins"] += 1
        self.save_ranking()

    # ------------------------------------------------------------ 보내기
    def room_view(self, room):
        members = []
        for cid, role in room.members:
            c = self.clients.get(cid)
            if c is None or c.profile is None:
                continue
            members.append({"cid": cid, "role": role, "online": c.gone_at is None, **c.profile})
        return {"id": room.id, "name": room.name, "game": room.game, "settings": room.settings,
                "host": room.host, "status": room.status, "members": members, "max": GAMES[room.game]}

    def room_summary(self, room):
        host = self.clients.get(room.host)
        return {"id": room.id, "name": room.name, "game": room.game, "status": room.status,
                "host": host.profile["name"] if host and host.profile else "?",
                "players": len(room.players()), "max": GAMES[room.game],
                "spectators": sum(1 for _, r in room.members if r == "spectator")}

    async def send_room(self, room):
        view = self.room_view(room)
        await asyncio.gather(*(self.clients[cid].send({"t": "room", "room": view})
                               for cid, _ in room.members if cid in self.clients))
        await self.send_rooms()

    async def send_rooms(self):
        rooms = [self.room_summary(r) for r in self.rooms.values()]
        await asyncio.gather(*(c.send({"t": "rooms", "rooms": rooms})
                               for c in self.clients.values() if c.room is None and c.profile))

    async def to_room(self, room, obj):
        await asyncio.gather(*(self.clients[cid].send(obj) for cid, _ in room.members if cid in self.clients))

    # ------------------------------------------------------------ 방
    def new_code(self):
        while True:
            code = "".join(secrets.choice(CODE_CHARS) for _ in range(4))
            if code not in self.rooms:
                return code

    async def join(self, client, room, want="player"):
        if client.room is not None:
            await self.leave(client)
        full = len(room.players()) >= GAMES[room.game]
        role = "player" if want == "player" and room.status == "waiting" and not full else "spectator"
        room.members.append([client.cid, role])
        client.room = room.id
        await self.send_room(room)
        if room.log:
            await client.send({"t": "log", "acts": room.log})
        await self.to_room(room, {"t": "notice", "kind": "join", "name": client.profile["name"], "role": role})

    async def leave(self, client, silent=False):
        room = self.rooms.get(client.room)
        client.room = None
        if room is None:
            return
        role = room.role_of(client.cid)
        room.members = [m for m in room.members if m[0] != client.cid]
        if not room.members:
            del self.rooms[room.id]
            await self.send_rooms()
            return
        if room.host == client.cid:
            online = [cid for cid, _ in room.members if self.clients[cid].gone_at is None]
            room.host = (online or [room.members[0][0]])[0]
        if room.status == "playing" and role == "player":
            await self.act(room, client.cid, {"type": "leave"})
        if not silent:
            await self.to_room(room, {"t": "notice", "kind": "leave", "name": client.profile["name"]})
        await self.send_room(room)

    async def act(self, room, cid, a):
        """게임 수 하나를 순서(seq)와 서버 시각(at)을 붙여 방 전체에 보냄."""
        room.seq += 1
        entry = {"seq": room.seq, "at": now_ms(), "from": cid, "a": a}
        if a.get("type") == "start":
            room.log = []
            room.status = "playing"
        if len(room.log) < MAX_LOG:
            room.log.append(entry)
        await self.to_room(room, {"t": "act", **entry})

    # ------------------------------------------------------------ 메시지 처리
    async def handle(self, client, msg):
        t = msg.get("t")
        if t == "ping":
            await client.send({"t": "pong", "c": msg.get("c"), "s": now_ms()})
            return
        if t == "profile":
            p = clean_profile(msg.get("profile"))
            if p:
                client.profile = p
                room = self.rooms.get(client.room)
                if room:
                    await self.send_room(room)
            return
        if client.profile is None:
            return
        room = self.rooms.get(client.room)
        if t == "rooms":
            await client.send({"t": "rooms", "rooms": [self.room_summary(r) for r in self.rooms.values()]})
        elif t == "ranking":
            await client.send({"t": "ranking", "ranking": self.ranking})
        elif t == "create":
            game = msg.get("game")
            if game not in GAMES:
                return
            settings = msg.get("settings") if isinstance(msg.get("settings"), dict) else {}
            settings = {k: clean_text(v, 20) for k, v in list(settings.items())[:8]}
            room = Room(self.new_code(), game, settings, client.cid)
            self.rooms[room.id] = room
            await self.join(client, room)
        elif t == "join":
            target = self.rooms.get(clean_text(msg.get("room"), 8).upper())
            if target is None:
                await client.send({"t": "error", "msg": "그 방은 없어요. 방 코드를 다시 확인해 주세요."})
                return
            if target is not room:
                await self.join(client, target, "spectator" if msg.get("as") == "spectator" else "player")
        elif t == "leave":
            await self.leave(client)
            await client.send({"t": "rooms", "rooms": [self.room_summary(r) for r in self.rooms.values()]})
        elif room is None:
            return
        elif t == "chat":
            text = clean_text(msg.get("text"), MAX_TEXT)
            sticker = clean_text(msg.get("sticker"), 10)
            if text or sticker:
                await self.to_room(room, {"t": "chat", "from": client.cid, "name": client.profile["name"],
                                          "text": text, "sticker": sticker, "at": now_ms()})
        elif t == "fx":  # 도발 멘트 · 티배깅처럼 기록할 필요 없는 효과
            fx = msg.get("fx")
            if isinstance(fx, dict):
                await self.to_room(room, {"t": "fx", "from": client.cid, "fx": fx})
        elif t == "settings" and client.cid == room.host and room.status != "playing":
            settings = msg.get("settings") if isinstance(msg.get("settings"), dict) else {}
            room.settings = {k: clean_text(v, 20) for k, v in list(settings.items())[:8]}
            await self.send_room(room)
        elif t == "seat" and room.status != "playing":  # 플레이어 <-> 관전자 바꾸기
            for m in room.members:
                if m[0] == client.cid:
                    if msg.get("role") == "spectator":
                        m[1] = "spectator"
                    elif len(room.players()) < GAMES[room.game]:
                        m[1] = "player"
            await self.send_room(room)
        elif t == "act":
            a = msg.get("a")
            if not isinstance(a, dict) or room.role_of(client.cid) != "player":
                return
            if a.get("type") == "start":
                if client.cid != room.host or room.status == "playing":
                    return
            elif room.status != "playing":
                return
            await self.act(room, client.cid, a)
        elif t == "result" and client.cid == room.host and room.status == "playing":
            room.status = "done"
            players = [clean_text(n, 12) for n in msg.get("players", [])][:6]
            winners = [clean_text(n, 12) for n in msg.get("winners", [])][:6]
            self.add_result(room.game, players, winners)
            await self.send_room(room)
        elif t == "reset" and client.cid == room.host:  # 한 판 더: 대기실로
            room.status = "waiting"
            room.log = []
            await self.to_room(room, {"t": "reset"})
            await self.send_room(room)

    async def drop_later(self, client):
        await asyncio.sleep(GRACE)
        if client.gone_at is not None and time.time() - client.gone_at >= GRACE - 0.5:
            await self.leave(client)
            self.clients.pop(client.cid, None)


hub = Hub()


async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=MAX_MSG)
    await ws.prepare(request)
    cid = clean_text(request.query.get("cid"), 40)
    if len(cid) < 8:
        cid = secrets.token_hex(8)
    client = hub.clients.get(cid)
    if client is None:
        client = hub.clients[cid] = Client(cid)
    elif client.ws is not None and not client.ws.closed:
        await client.ws.close()  # 같은 사람이 새 탭에서 들어오면 옛 연결은 정리
    client.ws = ws
    client.gone_at = None
    room = hub.rooms.get(client.room)
    await client.send({"t": "welcome", "cid": cid, "s": now_ms(), "room": hub.room_view(room) if room else None,
                       "rooms": [hub.room_summary(r) for r in hub.rooms.values()]})
    if room:  # 재접속: 지금까지의 수를 다시 보내서 판을 이어 줌
        await client.send({"t": "log", "acts": room.log})
        await hub.send_room(room)
    try:
        async for m in ws:
            if m.type != WSMsgType.TEXT:
                continue
            try:
                msg = json.loads(m.data)
            except ValueError:
                continue
            if isinstance(msg, dict):
                await hub.handle(client, msg)
    finally:
        if client.ws is ws:
            client.gone_at = time.time()
            room = hub.rooms.get(client.room)
            if room:
                await hub.send_room(room)
            asyncio.ensure_future(hub.drop_later(client))
    return ws


async def index(request):
    return web.FileResponse(os.path.join(STATIC, "index.html"), headers={"Cache-Control": "no-cache"})


async def health(request):
    return web.json_response({"ok": True, "rooms": len(hub.rooms)})


def make_app():
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/healthz", health)
    app.router.add_static("/fonts", FONTS)
    app.router.add_static("/", STATIC)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
