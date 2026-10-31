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

from ranking_store import make_store

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
RATE_WINDOW = 5  # 도배 막기: 이 시간(초) 동안
RATE_ALL, RATE_CHAT = 60, 8  # 메시지 전체 / 채팅 · 효과 최대 개수
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
        self.sent = {"all": [], "chat": []}  # 최근 보낸 메시지 시각 (도배 막기)

    def allow(self, kind, limit):
        now = time.time()
        times = self.sent[kind] = [x for x in self.sent[kind] if now - x < RATE_WINDOW]
        if len(times) >= limit:
            return False
        times.append(now)
        return True

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
        self.seat_names = []  # 판을 시작할 때 앉아 있던 사람들 (랭킹은 이 이름만 받음)
        self.seat_cids = []
        self.queue = []  # 다음 판을 기다리는 줄 (cid, 먼저 선 순서)
        self.streak = {}  # cid -> 이 방에서 이어 온 연승 수
        self.losers = []  # 지난 판에 진 사람 (한 판 더 할 때 줄 맨 뒤로)

    @property
    def private(self):
        return self.settings.get("private") == "1"

    def players(self):
        return [cid for cid, role in self.members if role == "player"]

    def set_role(self, cid, role):
        for m in self.members:
            if m[0] == cid:
                m[1] = role

    def role_of(self, cid):
        for c, role in self.members:
            if c == cid:
                return role
        return None


class Hub:
    def __init__(self):
        self.clients = {}
        self.rooms = {}
        self.store = make_store(RANKING_FILE)

    # ------------------------------------------------------------ 보내기
    def room_view(self, room):
        members = []
        for cid, role in room.members:
            c = self.clients.get(cid)
            if c is None or c.profile is None:
                continue
            members.append({"cid": cid, "role": role, "online": c.gone_at is None,
                            "streak": room.streak.get(cid, 0), **c.profile})
        return {"id": room.id, "name": room.name, "game": room.game, "settings": room.settings,
                "host": room.host, "status": room.status, "members": members, "max": GAMES[room.game],
                "queue": list(room.queue)}

    def room_summary(self, room):
        host = self.clients.get(room.host)
        king = max(room.streak.items(), key=lambda kv: kv[1], default=(None, 0))
        king_client = self.clients.get(king[0])
        return {"id": room.id, "name": room.name, "game": room.game, "status": room.status,
                "host": host.profile["name"] if host and host.profile else "?",
                "players": len(room.players()), "max": GAMES[room.game],
                "spectators": sum(1 for _, r in room.members if r == "spectator"), "queue": len(room.queue),
                "king": {"name": king_client.profile["name"], "streak": king[1]}
                if king[1] >= 2 and king_client and king_client.profile else None}

    async def send_room(self, room):
        view = self.room_view(room)
        await asyncio.gather(*(self.clients[cid].send({"t": "room", "room": view})
                               for cid, _ in room.members if cid in self.clients))
        await self.send_rooms()

    def public_rooms(self):
        """방 목록에 보이는 방 (비공개 방은 코드로만 들어옴)"""
        return [self.room_summary(r) for r in self.rooms.values() if not r.private]

    async def send_rooms(self):
        rooms = self.public_rooms()
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

    def fill_seats(self, room):
        """대기실에서 빈자리가 있으면 줄 앞사람부터 앉힘 (연결이 끊긴 사람은 건너뜀)."""
        if room.status == "playing":
            return
        for cid in list(room.queue):
            if len(room.players()) >= GAMES[room.game]:
                break
            c = self.clients.get(cid)
            if c is not None and c.gone_at is None and room.role_of(cid) == "spectator":
                room.queue.remove(cid)
                room.set_role(cid, "player")

    async def join(self, client, room, want="player"):
        if client.room is not None:
            await self.leave(client)
        full = len(room.players()) >= GAMES[room.game]
        role = "player" if want == "player" and room.status == "waiting" and not full and not room.queue else "spectator"
        if want == "player" and role == "spectator":
            room.queue.append(client.cid)  # 꽉 찼거나 대전 중이면 줄을 섬
        room.members.append([client.cid, role])
        self.fill_seats(room)
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
        if client.cid in room.queue:
            room.queue.remove(client.cid)
        room.streak.pop(client.cid, None)
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
        self.fill_seats(room)
        await self.send_room(room)

    async def act(self, room, cid, a):
        """게임 수 하나를 순서(seq)와 서버 시각(at)을 붙여 방 전체에 보냄."""
        room.seq += 1
        entry = {"seq": room.seq, "at": now_ms(), "from": cid, "a": a}
        if a.get("type") == "start":
            room.log = []
            room.status = "playing"
            room.seat_cids = [c for c in room.players() if c in self.clients]
            room.seat_names = [self.clients[c].profile["name"] for c in room.seat_cids]
            room.losers = []
        elif a.get("type") == "roll" and room.game == "yacht":
            a["dice"] = [secrets.randbelow(6) + 1 for _ in range(5)]  # 주사위는 서버가 굴림 (조작 방지)
        if len(room.log) < MAX_LOG:
            room.log.append(entry)
        await self.to_room(room, {"t": "act", **entry})

    # ------------------------------------------------------------ 메시지 처리
    async def handle(self, client, msg):
        t = msg.get("t")
        if not client.allow("all", RATE_ALL) or (t in ("chat", "fx") and not client.allow("chat", RATE_CHAT)):
            return  # 너무 빨리 보내면 버림
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
            await client.send({"t": "rooms", "rooms": self.public_rooms()})
        elif t == "ranking":
            await client.send({"t": "ranking", "ranking": await self.store.all(), "store": self.store.kind})
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
            await client.send({"t": "rooms", "rooms": self.public_rooms()})
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
        elif t == "seat":  # 플레이어 <-> 관전자, 꽉 찼으면 줄 서기
            role = room.role_of(client.cid)
            if msg.get("role") == "spectator":
                if client.cid in room.queue:
                    room.queue.remove(client.cid)  # 줄에서 빠지기
                elif role == "player" and room.status != "playing":
                    room.set_role(client.cid, "spectator")
            elif role == "spectator" and client.cid not in room.queue:
                room.queue.append(client.cid)
            self.fill_seats(room)
            await self.send_room(room)
        elif t == "act":
            a = msg.get("a")
            if not isinstance(a, dict):
                return
            who = client.cid
            if a.get("type") == "start":  # 방장은 줄로 밀려나 관전 중이어도 다음 판을 시작할 수 있음
                if client.cid != room.host or room.status == "playing" or not room.players():
                    return
            elif room.role_of(client.cid) != "player":
                return
            elif room.status != "playing":
                return
            elif msg.get("as"):  # 방장이 연결이 끊긴 사람 대신 둠 (컴퓨터가 대신)
                target = self.clients.get(str(msg["as"]))
                if (client.cid != room.host or target is None or target.gone_at is None
                        or room.role_of(target.cid) != "player" or a.get("type") in ("resign", "leave")):
                    return
                who = target.cid
            await self.act(room, who, a)
        elif t == "result" and client.cid == room.host and room.status == "playing":
            room.status = "done"
            players = list(dict.fromkeys(room.seat_names))  # 클라이언트가 보낸 이름 목록은 믿지 않음
            winners = [n for n in dict.fromkeys(clean_text(n, 12) for n in msg.get("winners", [])) if n in players]
            losers = [n for n in dict.fromkeys(clean_text(n, 12) for n in msg.get("losers", []))
                      if n in players and n not in winners]
            if winners:  # 무승부는 연승을 그대로 둠
                for cid, name in zip(room.seat_cids, room.seat_names):
                    room.streak[cid] = room.streak.get(cid, 0) + 1 if name in winners else 0
            room.losers = [cid for cid, name in zip(room.seat_cids, room.seat_names) if name in losers]
            if players:
                await self.store.add(room.game, players, winners)
            await self.send_room(room)
        elif t == "reset" and client.cid == room.host:  # 한 판 더: 대기실로
            room.status = "waiting"
            room.log = []
            if room.queue:  # 기다리는 사람이 있으면 진 사람은 줄 맨 뒤로, 줄 앞사람이 자리에 앉음
                for cid in room.losers:
                    if room.role_of(cid) == "player":
                        room.set_role(cid, "spectator")
                        room.queue.append(cid)
                self.fill_seats(room)
            room.losers = []
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
                       "rooms": hub.public_rooms()})
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


@web.middleware
async def no_stale_files(request, handler):
    """새로 배포하면 바로 새 화면이 보이도록, 브라우저가 매번 바뀌었는지 확인하게 함."""
    resp = await handler(request)
    if request.path.endswith((".js", ".css", ".html", ".webmanifest", "/")):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def make_app():
    app = web.Application(middlewares=[no_stale_files])
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/healthz", health)
    app.router.add_static("/fonts", FONTS)
    app.router.add_static("/", STATIC)

    async def close_store(_app):
        await hub.store.close()
    app.on_cleanup.append(close_store)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
