"""KI득KI득 웹 서버: 웹 화면(static/)을 보내 주고, 방 만들기 · 참가 · 채팅 · 게임 수를 웹소켓으로 이어 줌.

게임 규칙은 브라우저마다 똑같이 계산하고, 서버는 '누가 어떤 순서로 무엇을 했는지'만 정해서 모두에게 보냄.
(데스크톱판의 '방장 PC' 역할을 서버가 대신해서, 다른 와이파이 · 폰끼리도 같이 할 수 있음)

신원: 브라우저마다 비밀 열쇠(cid)를 들고 오고, 다른 사람에게는 공개 번호(pid)만 보여 줌.
      → 같은 방 사람이 남의 cid로 접속해 자리를 가로챌 수 없음.

실행: pip install -r web/requirements.txt  →  python web/server.py  →  http://localhost:8000
"""
import asyncio
import hashlib
import json
import os
import random
import secrets
import time
from urllib.parse import urlparse

import qrcode
import qrcode.image.svg
from aiohttp import WSMsgType, web

from ranking_store import make_store

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
FONTS = os.path.join(os.path.dirname(HERE), "fonts")
RANKING_FILE = os.environ.get("KIDK_RANKING_FILE", os.path.join(HERE, "ranking.json"))

GAMES = {"chess": 2, "omok": 2, "yacht": 6, "yut": 4}  # 게임 -> 최대 플레이어 수
SETTING_KEYS = {"time", "color", "rule", "private", "pieces", "chaos", "team", "tb"}  # 방 설정으로 받는 값
FX_KINDS = {"teabag", "taunt", "shake"}
YUT_SKINS = {"penguin", "tiger", "rabbit", "frog", "bear", "cat", "chick", "fox"}  # 기록 없이 전달하는 효과
MAX_MSG = 100_000  # 메시지 하나 최대 크기 (프로필 사진 포함해도 충분)
MAX_PHOTO = 60_000
MAX_ACT = 2_000  # 게임 수 하나의 최대 크기 (보통 100바이트 안팎)
MAX_TEXT = 100
MAX_LOG = 3000
GRACE = 30  # 연결이 끊긴 사람의 자리를 지켜 주는 시간(초)
RATE_WINDOW = 5  # 도배 막기: 이 시간(초) 동안
RATE_ALL, RATE_CHAT = 60, 8  # 메시지 전체 / 채팅 효과 최대 개수
RATE_CHAT_MESSAGES = 8  # 실제 채팅 메시지 최대 개수 (RATE_WINDOW 기준)
RATE_REPEAT_MESSAGES = 5  # 같은 내용은 짧은 시간에 최대 5회
MAX_PER_IP = int(os.environ.get("KIDK_MAX_PER_IP", 60))  # 한 주소(IP)당 동시 연결 (학교 와이파이는 반 전체가 같은 주소)
MAX_CLIENTS, MAX_ROOMS = 1000, 300  # 서버 전체 상한 (무료 서버가 버틸 만큼)
IDLE_LOBBY, IDLE_ROOM = 20 * 60, 45 * 60  # 이만큼(초) 아무것도 안 하면 연결을 끊어 서버가 잠들 수 있게 함
ROOM_ADJ = ["용감한", "졸린", "신나는", "수줍은", "배고픈", "반짝이는", "느긋한", "씩씩한", "엉뚱한", "다정한"]
ROOM_ANIMAL = ["판다", "여우", "토끼", "곰돌이", "병아리", "개구리", "고양이", "돼지", "펭귄", "다람쥐"]
ANIMALS = {"cat", "bear", "rabbit", "frog", "chick", "pig", "panda", "fox", "penguin", "tiger"}
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 헷갈리는 0/O, 1/I 뺌


def now_ms():
    return int(time.time() * 1000)


def clean_text(s, limit):
    return " ".join(str(s or "").split())[:limit]


def clean_settings(raw):
    if not isinstance(raw, dict):
        return {}
    # tb: 윷놀이 팀전의 B팀 명단 (공개 번호 2개를 쉼표로) → 조금 더 길게 받음
    return {k: clean_text(v, 40 if k == "tb" else 10) for k, v in raw.items() if k in SETTING_KEYS}


def clean_fx(fx):
    """효과는 정해진 종류와 칸만 통과 (아무 데이터나 방 전체에 뿌리지 못하게)."""
    if not isinstance(fx, dict) or fx.get("kind") not in FX_KINDS:
        return None
    out = {"kind": fx["kind"]}
    for k in ("from", "to", "seat"):
        if isinstance(fx.get(k), int) and 0 <= fx[k] < 6:
            out[k] = fx[k]
    if isinstance(fx.get("text"), str):
        out["text"] = clean_text(fx["text"], 40)
    if isinstance(fx.get("on"), bool):
        out["on"] = fx["on"]
    return out


class Client:
    def __init__(self, cid, ip):
        self.cid = cid  # 비밀 (본인 브라우저만 앎)
        self.pid = secrets.token_hex(6)  # 공개 번호 (다른 사람에게 보이는 이름표)
        self.ip = ip
        self.ws = None
        self.profile = None  # {name, avatar, intro} avatar는 동물 이름 또는 "photo:<pid>:<해시>"
        self.photo = None  # 사진 data URL (따로 한 번만 보냄)
        self.room = None
        self.gone_at = None  # 연결이 끊긴 시각 (다시 들어오면 None)
        self.last_active = time.time()
        self.sent = {"all": [], "chat": []}  # 최근 보낸 메시지 시각 (도배 막기)
        self.sent_chat = []

    def allow(self, kind, limit):
        now = time.time()
        times = self.sent[kind] = [x for x in self.sent[kind] if now - x < RATE_WINDOW]
        if len(times) >= limit:
            return False
        times.append(now)
        return True

    def allow_chat(self, text, sticker):
        now = time.time()
        key = (text.casefold(), sticker)
        self.sent_chat = [(at, sent_key) for at, sent_key in self.sent_chat if now - at < RATE_WINDOW]
        if sum(1 for _, sent_key in self.sent_chat if sent_key == key) >= RATE_REPEAT_MESSAGES:
            return False
        if len(self.sent_chat) >= RATE_CHAT_MESSAGES:
            return False
        self.sent_chat.append((now, key))
        return True

    def set_profile(self, p):
        """닉네임 · 프로필 · 한 줄 소개만 받아서 길이를 자름. 사진이 바뀌었으면 True."""
        if not isinstance(p, dict):
            return False
        name = clean_text(p.get("name"), 12)
        if not name:
            return False
        av = p.get("avatar")
        photo = None
        if isinstance(av, str) and av in ANIMALS:
            avatar = av
        elif isinstance(av, str) and av.startswith("data:image/") and len(av) <= MAX_PHOTO:
            photo = av
            avatar = f"photo:{self.pid}:{hashlib.sha1(av.encode()).hexdigest()[:8]}"
        else:
            avatar = "cat"
        changed = photo is not None and photo != self.photo
        self.photo = photo
        self.profile = {"name": name, "avatar": avatar, "intro": clean_text(p.get("intro"), 30)}
        return changed

    async def send(self, obj):
        if self.ws is not None and not self.ws.closed:
            try:
                await self.ws.send_str(json.dumps(obj, ensure_ascii=False))
            except (ConnectionResetError, RuntimeError):
                pass


def clean_profile(p):
    """(테스트용) 프로필 정리 규칙만 확인."""
    c = Client("x" * 8, "")
    return c.profile if c.set_profile(p) or c.profile else None


class Room:
    def __init__(self, rid, game, settings, host):
        self.id = rid
        self.game = game
        self.settings = settings
        self.name = f"{random.choice(ROOM_ADJ)} {random.choice(ROOM_ANIMAL)} 방"
        self.host = host  # cid
        self.members = []  # [cid, role] 들어온 순서대로. role: player / spectator
        self.yut_skins = {}  # cid -> character id; empty means unselected
        self.status = "waiting"  # waiting / playing / done
        self.log = []  # 이번 판의 수 (늦게 들어온 사람과 재접속한 사람이 다시 계산하는 재료)
        self.seq = 0
        self.seat_names = []  # 판을 시작할 때 앉아 있던 사람들 (랭킹은 이 이름만 받음)
        self.seat_cids = []
        self.queue = []  # 다음 판을 기다리는 줄 (cid, 먼저 선 순서)
        self.streak = {}  # cid -> 이 방에서 이어 온 연승 수
        self.losers = []  # 지난 판에 진 사람 (한 판 더 할 때 줄 맨 뒤로)
        self.banned = set()  # 방장이 내보낸 사람 (cid)

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
        self.clients = {}  # cid -> Client
        self.by_pid = {}  # pid -> Client
        self.rooms = {}
        self.store = make_store(RANKING_FILE)

    def pid(self, cid):
        c = self.clients.get(cid)
        return c.pid if c else None

    def connections_from(self, ip):
        return sum(1 for c in self.clients.values() if c.ip == ip and c.ws is not None and not c.ws.closed)

    # ------------------------------------------------------------ 보내기
    def room_view(self, room):
        members = []
        for cid, role in room.members:
            c = self.clients.get(cid)
            if c is None or c.profile is None:
                continue
            members.append({"cid": c.pid, "role": role, "online": c.gone_at is None,
                            "gone": int(c.gone_at * 1000) if c.gone_at else None,
                            "streak": room.streak.get(cid, 0),
                            "yut_skin": room.yut_skins.get(cid, "") if room.game == "yut" else "", **c.profile})
        return {"id": room.id, "name": room.name, "game": room.game, "settings": room.settings,
                "host": self.pid(room.host), "status": room.status, "members": members, "max": GAMES[room.game],
                "queue": [self.pid(c) for c in room.queue], "grace": GRACE}

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

    async def send_photos(self, room, to=None, only=None):
        """프로필 사진은 방 정보와 따로 한 번만 보냄 (방이 바뀔 때마다 사진을 다시 보내지 않게)."""
        photos = {}
        for cid, _ in room.members:
            c = self.clients.get(cid)
            if c and c.photo and (only is None or c is only):
                photos[c.pid] = c.photo
        if not photos:
            return
        targets = [to] if to else [self.clients[cid] for cid, _ in room.members if cid in self.clients]
        await asyncio.gather(*(t.send({"t": "photos", "photos": photos}) for t in targets))

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
        if client.cid in room.banned:
            await client.send({"t": "error", "msg": "방장이 내보낸 방이라 다시 들어갈 수 없어요."})
            return
        if client.room is not None:
            await self.leave(client)
        full = len(room.players()) >= GAMES[room.game]
        role = "player" if want == "player" and room.status == "waiting" and not full and not room.queue else "spectator"
        if want == "player" and role == "spectator":
            room.queue.append(client.cid)  # 꽉 찼거나 대전 중이면 줄을 섬
        room.members.append([client.cid, role])
        self.fill_seats(room)
        client.room = room.id
        await self.send_photos(room, to=client)
        await self.send_photos(room, only=client)
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
        room.yut_skins.pop(client.cid, None)
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

    def seats_for_start(self, room, order):
        """판에 앉는 사람 목록은 서버가 만듦 (이름 · 사진을 방장 마음대로 바꿀 수 없게).
        order: 방장이 정한 자리 순서 (체스 · 오목 색 고르기). 공개 번호(pid) 목록."""
        cids = [c for c in room.players() if c in self.clients and self.clients[c].profile]
        if isinstance(order, list):
            pos = {p: i for i, p in enumerate(order)}
            if sorted(pos) == sorted(self.clients[c].pid for c in cids):
                cids.sort(key=lambda c: pos[self.clients[c].pid])
        seats = []
        for cid in cids:
            seat = {"cid": self.clients[cid].pid, **self.clients[cid].profile}
            if room.game == "yut":
                seat["yut_skin"] = room.yut_skins.get(cid, "")
            seats.append(seat)
        return cids, seats

    async def act(self, room, cid, a):
        """게임 수 하나를 순서(seq)와 서버 시각(at)을 붙여 방 전체에 보냄."""
        room.seq += 1
        entry = {"seq": room.seq, "at": now_ms(), "from": self.pid(cid), "a": a}
        if a.get("type") == "start":
            room.log = []
            room.status = "playing"
            room.seat_cids, a["seats"] = self.seats_for_start(room, a.pop("order", None))
            room.seat_names = [self.clients[c].profile["name"] for c in room.seat_cids]
            room.losers = []
            if room.game == "yut":
                a["seed"] = secrets.randbits(31)  # 시작 카드 나눠 주기도 서버가 정한 씨앗으로
        elif a.get("type") == "roll" and room.game == "yacht":
            a["dice"] = [secrets.randbelow(6) + 1 for _ in range(5)]  # 주사위는 서버가 굴림 (조작 방지)
        elif room.game == "yut":
            a["seed"] = secrets.randbits(31)  # 윷 결과 · 능력 뽑기 등 모든 무작위는 서버가 정한 씨앗으로
        if len(room.log) < MAX_LOG:
            room.log.append(entry)
        await self.to_room(room, {"t": "act", **entry})

    # ------------------------------------------------------------ 메시지 처리
    async def handle(self, client, msg):
        t = msg.get("t")
        if not client.allow("all", RATE_ALL) or (t == "fx" and not client.allow("chat", RATE_CHAT)):
            return  # 너무 빨리 보내면 버림
        if t == "ping":
            await client.send({"t": "pong", "c": msg.get("c"), "s": now_ms()})
            return
        client.last_active = time.time()
        if t == "profile":
            photo_changed = client.set_profile(msg.get("profile"))
            room = self.rooms.get(client.room)
            if room and client.profile:
                if photo_changed:
                    await self.send_photos(room, only=client)
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
            if len(self.rooms) >= MAX_ROOMS:
                await client.send({"t": "error", "msg": "지금은 방이 너무 많아요. 잠시 뒤에 다시 만들어 주세요."})
                return
            room = Room(self.new_code(), game, clean_settings(msg.get("settings")), client.cid)
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
            if (text or sticker) and client.allow_chat(text, sticker):
                await self.to_room(room, {"t": "chat", "from": client.pid, "name": client.profile["name"],
                                          "text": text, "sticker": sticker, "at": now_ms()})
        elif t == "fx":  # 도발 멘트 · 티배깅 · 컵 흔들기처럼 기록할 필요 없는 효과
            fx = clean_fx(msg.get("fx"))
            if fx:
                await self.to_room(room, {"t": "fx", "from": client.pid, "fx": fx})
        elif t == "yut_skin" and room.game == "yut" and room.status != "playing":
            target = self.by_pid.get(str(msg.get("pid") or client.pid))
            if target is None or target.room != room.id or room.role_of(target.cid) != "player":
                return
            if target is not client and client.cid != room.host:
                return
            skin = msg.get("skin")
            if not isinstance(skin, str) or (skin and skin not in YUT_SKINS):
                return
            if skin and any(cid != target.cid and room.role_of(cid) == "player" and room.yut_skins.get(cid) == skin for cid, _ in room.members):
                return
            room.yut_skins[target.cid] = skin
            await self.send_room(room)
        elif t == "settings" and client.cid == room.host and room.status != "playing":
            room.settings = clean_settings(msg.get("settings"))
            await self.send_room(room)
        elif t == "kick" and client.cid == room.host:  # 방장이 내보내기
            target = self.by_pid.get(str(msg.get("pid")))
            if target is None or target is client or target.room != room.id:
                return
            room.banned.add(target.cid)
            await target.send({"t": "kicked", "room": room.id})
            await self.leave(target, silent=True)
            await self.to_room(room, {"t": "notice", "kind": "kick", "name": target.profile["name"]})
            await target.send({"t": "rooms", "rooms": self.public_rooms()})
        elif t == "seat":  # 플레이어 <-> 관전자, 꽉 찼으면 줄 서기
            role = room.role_of(client.cid)
            if msg.get("role") == "spectator":
                if client.cid in room.queue:
                    room.queue.remove(client.cid)  # 줄에서 빠지기
                elif role == "player" and room.status != "playing":
                    room.set_role(client.cid, "spectator")
                    room.yut_skins.pop(client.cid, None)
            elif role == "spectator" and client.cid not in room.queue:
                if room.game == "yut":
                    room.yut_skins[client.cid] = ""
                room.queue.append(client.cid)
            self.fill_seats(room)
            await self.send_room(room)
        elif t == "act":
            a = msg.get("a")
            if not isinstance(a, dict) or len(json.dumps(a)) > MAX_ACT:
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
                target = self.by_pid.get(str(msg["as"]))
                if (client.cid != room.host or target is None or target.gone_at is None
                        or room.role_of(target.cid) != "player" or a.get("type") in ("resign", "leave")):
                    return
                who = target.cid
            await self.act(room, who, a)
        elif t == "result" and client.cid == room.host and room.status == "playing":
            room.status = "done"
            players = list(dict.fromkeys(room.seat_names))  # 클라이언트가 보낸 이름 목록은 믿지 않음
            winners = [n for n in dict.fromkeys(clean_text(n, 12) for n in msg.get("winners", [])[:6]) if n in players]
            losers = [n for n in dict.fromkeys(clean_text(n, 12) for n in msg.get("losers", [])[:6])
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
            self.by_pid.pop(client.pid, None)

    async def reap_idle(self, interval=60):
        """오래 아무것도 안 한 연결을 끊음. 열어 둔 탭 때문에 무료 서버가 잠들지 못해
        한 달 무료 시간을 다 쓰는 일을 막음. (브라우저는 다시 보면 알아서 다시 붙음)"""
        while True:
            await asyncio.sleep(interval)
            now = time.time()
            for c in list(self.clients.values()):
                limit = IDLE_ROOM if c.room else IDLE_LOBBY
                if c.ws is not None and not c.ws.closed and now - c.last_active > limit:
                    await c.ws.close(code=4000, message=b"idle")


hub = Hub()


def client_ip(request):
    """Render 같은 프록시 뒤에서는 마지막 프록시가 붙인 주소가 진짜 접속 주소."""
    for h in ("CF-Connecting-IP", "True-Client-IP"):
        if request.headers.get(h):
            return request.headers[h].strip()
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[-1].strip()
    return request.remote or ""


def same_origin(request):
    """다른 웹사이트가 몰래 우리 서버에 웹소켓을 여는 것을 막음 (Origin이 없으면 앱 · 테스트로 보고 허용)."""
    origin = request.headers.get("Origin")
    return not origin or urlparse(origin).netloc == request.host


async def ws_handler(request):
    if not same_origin(request):
        return web.Response(status=403, text="origin")
    ip = client_ip(request)
    cid = clean_text(request.query.get("cid"), 40)
    existing = hub.clients.get(cid) if len(cid) >= 16 else None
    if existing is None and (hub.connections_from(ip) >= MAX_PER_IP or len(hub.clients) >= MAX_CLIENTS):
        return web.Response(status=429, text="too many connections")
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=MAX_MSG)
    await ws.prepare(request)
    if len(cid) < 16:
        cid = secrets.token_hex(16)
    client = hub.clients.get(cid)
    if client is None:
        client = hub.clients[cid] = Client(cid, ip)
        hub.by_pid[client.pid] = client
    elif client.ws is not None and not client.ws.closed:
        await client.ws.close()  # 같은 사람이 새 탭에서 들어오면 옛 연결은 정리
    client.ws = ws
    client.ip = ip
    client.gone_at = None
    client.last_active = time.time()
    room = hub.rooms.get(client.room)
    await client.send({"t": "welcome", "cid": cid, "pid": client.pid, "s": now_ms(),
                       "room": hub.room_view(room) if room else None, "rooms": hub.public_rooms()})
    if room:  # 재접속: 사진 · 지금까지의 수를 다시 보내서 판을 이어 줌
        await hub.send_photos(room, to=client)
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
    return web.FileResponse(os.path.join(STATIC, "index.html"))


async def health(request):
    return web.json_response({"ok": True})


async def qr(request):
    """방 링크 QR 코드 (SVG). 교실 화면에 크게 띄워 폰으로 찍어 들어오게 함. 우리 방 링크만 만들어 줌."""
    code = request.match_info["code"].upper()
    if len(code) != 4 or any(ch not in CODE_CHARS for ch in code):
        return web.Response(status=404)
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    img = qrcode.make(f"{scheme}://{request.host}/?room={code}", image_factory=qrcode.image.svg.SvgPathImage,
                      box_size=10, border=2)
    return web.Response(body=img.to_string(), content_type="image/svg+xml", headers={"Cache-Control": "max-age=3600"})


CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


@web.middleware
async def headers(request, handler):
    """보안 헤더 + 새로 배포하면 바로 새 화면이 보이도록 캐시 확인."""
    resp = await handler(request)
    if request.path.endswith((".js", ".css", ".html", ".webmanifest", "/")):
        resp.headers["Cache-Control"] = "no-cache"
    resp.headers["Content-Security-Policy"] = CSP  # 혹시 화면에 코드가 섞여 들어가도 실행되지 않게
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return resp


def make_app():
    app = web.Application(middlewares=[headers])
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/healthz", health)
    app.router.add_get("/qr/{code}.svg", qr)
    app.router.add_static("/fonts", FONTS)
    app.router.add_static("/", STATIC)

    async def start_reaper(_app):
        _app["reaper"] = asyncio.ensure_future(hub.reap_idle())

    async def cleanup(_app):
        _app["reaper"].cancel()
        await hub.store.close()
    app.on_startup.append(start_reaper)
    app.on_cleanup.append(cleanup)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
