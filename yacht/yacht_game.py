"""야추 다이스 (tkinter, 외부 라이브러리 없음)

실행: python yacht/yacht_game.py
- 모드: 한 PC(2~6명 번갈아) / 컴퓨터 대전 / 네트워크(같은 와이파이, 2~6명)
- 한 차례에 최대 3번 굴리기, 주사위를 클릭하면 고정, 점수표의 빈칸을 클릭해 기록
- 네트워크: 한 명이 '방 만들기' -> 나머지가 그 IP로 '참가하기' -> 방장이 '게임 시작'
"""
import json
import math
import os
import queue
import random
import socket
import sys
import threading
import time
import tkinter as tk
import tkinter.font as tkfont
from tkinter import messagebox

sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hub"))  # 공통 모듈
import ui_kit  # 그라데이션 배경, 둥근 카드/버튼, 참가자 카드

try:  # 주사위 컵을 매끈하게 (없으면 tk 도형으로)
    from PIL import Image, ImageDraw, ImageFilter, ImageTk
except ImportError:
    Image = None
try:  # 미니게임룸(hub)에서 실행하면 프로필 그림을 씀
    import avatars
except ImportError:
    avatars = None
try:  # 미니게임룸(hub)에서 실행하면 채팅/스티커
    import chat
except ImportError:
    chat = None
try:  # 미니게임룸(hub)에서 실행하면 결과 화면에서 멘트/티배깅
    import party
except ImportError:
    party = None

PORT = 50008
MAX_LINE = 300_000  # 네트워크 메시지 한 줄 최대 길이 (프로필 사진 포함해도 충분)
MAX_PLAYERS = 6

# ---------------------------------------------------------------- 규칙

UPPER = ["ones", "twos", "threes", "fours", "fives", "sixes"]
LOWER = ["choice", "four", "full", "sstraight", "lstraight", "yacht"]
CATEGORIES = UPPER + LOWER
CAT_NAMES = {
    "ones": "에이스", "twos": "듀스", "threes": "트레이", "fours": "포", "fives": "파이브", "sixes": "식스",
    "choice": "초이스", "four": "포 카인드", "full": "풀 하우스",
    "sstraight": "S. 스트레이트", "lstraight": "L. 스트레이트", "yacht": "야추",
}
CAT_HELP = {
    **{c: f"{i + 1}이(가) 나온 주사위 눈의 합" for i, c in enumerate(UPPER)},
    "choice": "주사위 5개 눈의 합",
    "four": "같은 눈이 4개 이상일 때, 그 4개의 합",
    "full": "같은 눈 3개 + 같은 눈 2개일 때, 5개의 합",
    "sstraight": "연속된 숫자 4개 (예: 1-2-3-4) → 15점",
    "lstraight": "연속된 숫자 5개 (1-2-3-4-5 또는 2-3-4-5-6) → 30점",
    "yacht": "5개 모두 같은 눈 → 50점",
}
BONUS_NEED, BONUS = 63, 35


def score(cat, dice):
    counts = [dice.count(v) for v in range(1, 7)]
    if cat in UPPER:
        face = UPPER.index(cat) + 1
        return face * counts[face - 1]
    faces = set(dice)
    if cat == "choice":
        return sum(dice)
    if cat == "four":
        for face in range(1, 7):
            if counts[face - 1] >= 4:
                return face * 4
        return 0
    if cat == "full":
        return sum(dice) if sorted(c for c in counts if c) == [2, 3] else 0
    if cat == "sstraight":
        return 15 if any(set(run) <= faces for run in ((1, 2, 3, 4), (2, 3, 4, 5), (3, 4, 5, 6))) else 0
    if cat == "lstraight":
        return 30 if faces in ({1, 2, 3, 4, 5}, {2, 3, 4, 5, 6}) else 0
    if cat == "yacht":
        return 50 if max(counts) == 5 else 0
    raise ValueError(cat)


class YachtGame:
    def __init__(self, names=(), ai=()):
        self.players = [{"name": n, "scores": {}, "ai": i in ai, "left": False} for i, n in enumerate(names)]
        self.current = 0
        self.dice = [1] * 5
        self.held = [False] * 5
        self.rolls_left = 3
        self.roll_id = 0  # 굴릴 때마다 증가 -> 화면이 애니메이션 시점을 앎
        self.over = False

    def to_dict(self):
        return {"players": self.players, "current": self.current, "dice": self.dice, "held": self.held,
                "rolls_left": self.rolls_left, "roll_id": self.roll_id, "over": self.over}

    @classmethod
    def from_dict(cls, d):
        g = cls()
        g.players = d["players"]
        g.current = d["current"]
        g.dice = d["dice"]
        g.held = d["held"]
        g.rolls_left = d["rolls_left"]
        g.roll_id = d["roll_id"]
        g.over = d["over"]
        return g

    @property
    def rolled(self):
        return self.rolls_left < 3

    @property
    def round(self):
        return min(len(self.players[self.current]["scores"]) + 1, 12)

    def roll(self):
        if self.over or self.rolls_left == 0:
            return False
        for i in range(5):
            if not self.held[i]:
                self.dice[i] = random.randint(1, 6)
        self.rolls_left -= 1
        self.roll_id += 1
        return True

    def toggle(self, i):
        if self.over or not self.rolled or self.rolls_left == 0:
            return False
        self.held[i] = not self.held[i]
        return True

    def record(self, cat):
        scores = self.players[self.current]["scores"]
        if self.over or not self.rolled or cat in scores:
            return False
        scores[cat] = score(cat, self.dice)
        self.held = [False] * 5
        self.rolls_left = 3
        self._advance()
        return True

    def active(self):
        return [i for i, p in enumerate(self.players) if not p.get("resigned")]

    def _advance(self):
        """다음 차례로 (항복한 사람은 건너뜀). 끝났으면 over."""
        act = self.active()
        humans = [i for i in act if not self.players[i]["ai"]]
        if len(act) <= 1 or (not humans and len(act) < len(self.players)) or \
                all(len(self.players[i]["scores"]) == len(CATEGORIES) for i in act):
            self.over = True
            return
        n = len(self.players)
        nxt = (self.current + 1) % n
        while self.players[nxt].get("resigned"):
            nxt = (nxt + 1) % n
        self.current = nxt

    def resign(self, seat):
        """seat 자리가 항복. 그 사람 차례였으면 다음 사람으로."""
        if self.over or not 0 <= seat < len(self.players) or self.players[seat].get("resigned"):
            return False
        self.players[seat]["resigned"] = True
        if seat == self.current:
            self.held = [False] * 5
            self.rolls_left = 3
        if seat == self.current or len(self.active()) <= 1:
            self._advance()
        else:
            act = self.active()
            humans = [i for i in act if not self.players[i]["ai"]]
            if not humans:
                self.over = True
        return True

    @staticmethod
    def upper_sum(p):
        return sum(v for c, v in p["scores"].items() if c in UPPER)

    def bonus(self, p):
        return BONUS if self.upper_sum(p) >= BONUS_NEED else 0

    def total(self, p):
        return sum(p["scores"].values()) + self.bonus(p)

    def ranking(self):
        """항복한 사람은 점수와 상관없이 뒤로."""
        return sorted(range(len(self.players)),
                      key=lambda i: (bool(self.players[i].get("resigned")), -self.total(self.players[i])))


# ---------------------------------------------------------------- 컴퓨터 AI

# 카테고리별 '평균적으로 기대되는 점수' - 이보다 많이 얻는 칸을 고르고, 0점이면 기대가 낮은 칸을 버림
AI_BASE = {"ones": 2, "twos": 5, "threes": 8, "fours": 11, "fives": 14, "sixes": 17, "choice": 21,
           "four": 9, "full": 12, "sstraight": 10, "lstraight": 8, "yacht": 4}


def ai_pick_category(game, level="normal"):
    p = game.players[game.current]
    open_cats = [c for c in CATEGORIES if c not in p["scores"]]

    def utility(c):
        u = score(c, game.dice) - AI_BASE[c]
        if c in UPPER and YachtGame.upper_sum(p) < BONUS_NEED:
            face = UPPER.index(c) + 1
            u += (game.dice.count(face) - 3) * face * 0.5  # 보너스 진행에 도움되면 가산
        return u

    ranked = sorted(open_cats, key=utility, reverse=True)
    if level == "easy" and len(ranked) > 1 and random.random() < 0.45:
        return random.choice(ranked[1:4])  # 쉬움: 가끔 아깝게 기록
    if level == "normal" and len(ranked) > 1 and random.random() < 0.12:
        return ranked[1]
    return ranked[0]


def ai_should_stop(game):
    p = game.players[game.current]["scores"]
    good = [c for c in ("yacht", "lstraight", "full", "four") if c not in p and score(c, game.dice) > 0]
    if "sstraight" not in p and "lstraight" in p and score("sstraight", game.dice) > 0:
        good.append("sstraight")
    return bool(good)


def ai_holds(game):
    d = game.dice
    p = game.players[game.current]["scores"]
    faces = set(d)
    if "lstraight" not in p or "sstraight" not in p:
        for run in ((2, 3, 4, 5), (3, 4, 5, 6), (1, 2, 3, 4)):
            if len(set(run) & faces) >= 4 or (len(set(run) & faces) == 3 and max(d.count(v) for v in d) < 2):
                held, used = [False] * 5, set()
                for i, v in enumerate(d):
                    if v in run and v not in used:
                        held[i] = True
                        used.add(v)
                return held
    counts = {v: d.count(v) for v in faces}
    best = max(faces, key=lambda v: (counts[v], v))
    if counts[best] == 1:
        return [v >= 5 for v in d] if "choice" not in p else [False] * 5
    return [v == best for v in d]


try:  # 효과음 (없으면 조용히)
    import sound
except ImportError:
    sound = None


def sfx(name):
    if sound is not None:
        sound.play(name)


# ---------------------------------------------------------------- 네트워크 도우미

def local_ip():
    """같은 와이파이에서 상대가 접속할 이 PC의 내부 IP."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # 실제로 패킷을 보내지 않고 사용할 네트워크 인터페이스만 고름
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return socket.gethostbyname(socket.gethostname())


def send_json(conn, obj):
    try:
        conn.sendall((json.dumps(obj) + "\n").encode("utf-8"))
    except (OSError, AttributeError):
        pass  # 끊김은 읽기 스레드가 알려줌


# ---------------------------------------------------------------- 화면

BG = "#16132B"
PANEL = "#221E3D"
CARD = "#2F2A52"
TEXT = "#F3F1FF"
MUTED = "#9F9AC8"
ACCENT = "#7C5CFF"
DANGER = "#FF5C7A"
GOLD = "#FFC94D"
PINK = "#FF5C8A"
WOOD = "#B27646"
FELT = "#B5232C"
PAPER = "#E6DCC5"  # 점수표 칸 사이 선
CELL = "#FFFCF5"
HILITE = "#FFE07A"
INK = "#2E2923"
INK_SOFT = "#A8997A"
BAND = "#3B3630"
PLAYER_COLORS = ["#7C5CFF", "#FF5C8A", "#22B07D", "#FF9F43", "#3D8BFF", "#B05CFF"]
if sys.platform == "darwin":
    UI_FONT, MONO_FONT, NUM_FONT = "Apple SD Gothic Neo", "Menlo", "Avenir Next"
elif sys.platform.startswith("win"):
    UI_FONT, MONO_FONT, NUM_FONT = "Malgun Gothic", "Consolas", "Bahnschrift"
else:
    UI_FONT, MONO_FONT, NUM_FONT = "Noto Sans CJK KR", "DejaVu Sans Mono", "DejaVu Sans"

# 앱에 함께 넣은 주아체 (fonts/Jua-Regular.ttf, SIL OFL). 시작할 때 이 프로그램 안에서만 쓰도록 불러옴
FONT_FILE = "Jua-Regular.ttf"
FONT_NAME = "Jua"
BOLD = "bold"  # 주아체를 쓰면 "normal": 굵기가 하나뿐인 폰트를 억지로 굵게 만들지 않도록
_font_loaded = None


def _find_font_file():
    here = os.path.dirname(os.path.abspath(__file__))
    for base in (getattr(sys, "_MEIPASS", None), here, os.path.dirname(here), os.path.dirname(sys.executable)):
        if not base:
            continue
        for sub in ("fonts", ""):
            path = os.path.join(base, sub, FONT_FILE)
            if os.path.isfile(path):
                return path
    return None


def load_bundled_font():
    """주아체 파일을 지금 실행 중인 프로그램에만 등록 (PC에 설치하지 않음). 성공하면 True."""
    global _font_loaded
    if _font_loaded is not None:
        return _font_loaded
    _font_loaded = False
    path = _find_font_file()
    if not path:
        return False
    try:
        import ctypes
        if sys.platform.startswith("win"):
            _font_loaded = ctypes.windll.gdi32.AddFontResourceExW(path, 0x10, 0) > 0  # 0x10 = 이 프로그램 전용
        elif sys.platform == "darwin":
            cf = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
            ct = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreText.framework/CoreText")
            cf.CFURLCreateFromFileSystemRepresentation.restype = ctypes.c_void_p
            cf.CFURLCreateFromFileSystemRepresentation.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long,
                                                                   ctypes.c_bool]
            ct.CTFontManagerRegisterFontsForURL.restype = ctypes.c_bool
            ct.CTFontManagerRegisterFontsForURL.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p]
            raw = path.encode("utf-8")
            url = cf.CFURLCreateFromFileSystemRepresentation(None, raw, len(raw), False)
            _font_loaded = bool(url) and bool(ct.CTFontManagerRegisterFontsForURL(url, 1, None))  # 1 = 이 프로그램 전용
    except (OSError, AttributeError):
        _font_loaded = False
    return _font_loaded


def setup_fonts(root):
    """주아체를 불러와 화면 글씨체로 씀 (실패하면 기본 글씨체). (UI_FONT, NUM_FONT)를 돌려줌."""
    global UI_FONT, NUM_FONT, BOLD
    load_bundled_font()
    import tkinter.font as tkfont
    if FONT_NAME in set(tkfont.families(root)):
        UI_FONT = NUM_FONT = FONT_NAME
        BOLD = "normal"
    return UI_FONT, NUM_FONT

PIPS = {
    1: [(0, 0)], 2: [(-1, -1), (1, 1)], 3: [(-1, -1), (0, 0), (1, 1)],
    4: [(-1, -1), (1, -1), (-1, 1), (1, 1)], 5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)],
    6: [(-1, -1), (-1, 0), (-1, 1), (1, -1), (1, 0), (1, 1)],
}
ROLL_MS = 650  # 컴퓨터 차례 사이 기본 대기 시간
MAX_ROLL_S = 2.6  # 주사위가 이 시간 안에 반드시 멈춤


def blend(c1, c2, t):
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02X%02X%02X" % tuple(round(x + (y - x) * t) for x, y in zip(a, b))


_cup_cache = {}


def _vgrad(w, h, stops):
    """세로 그라데이션 이미지. stops: [(0~1 위치, 색)]"""
    col = Image.new("RGB", (1, h))
    rgb = [(t, tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))) for t, c in stops]
    for y in range(h):
        t = y / max(h - 1, 1)
        for (t0, c0), (t1, c1) in zip(rgb, rgb[1:]):
            if t0 <= t <= t1:
                u = (t - t0) / max(t1 - t0, 1e-6)
                col.putpixel((0, y), tuple(round(a + (b - a) * u) for a, b in zip(c0, c1)))
                break
    return col.resize((w, h))


def cup_image(length, h):
    """옆으로 눕힌 가죽 주사위 컵 (입구는 왼쪽). 반환: (이미지, 입구 중심 x, 위쪽 여백)
    크게 그린 뒤 줄여서 가장자리가 매끈함."""
    key = (int(length), int(h))
    if key in _cup_cache:
        return _cup_cache[key]
    ss = 3
    H = int(h) * ss
    rx = H * 0.2  # 입구 타원 가로 반지름
    pad = int(H * 0.16)  # 그림자/여유
    mx = int(rx + pad)  # 입구 중심 x
    L = int(length) * ss + mx
    W2, H2 = L + pad, H + 2 * pad
    cy = pad + H / 2
    im = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))

    # 1) 나무 위에 부드러운 그림자
    sh = Image.new("L", (W2, H2), 0)
    ImageDraw.Draw(sh).rounded_rectangle((mx - rx * 0.6, cy - H * 0.32 + H * 0.2, L + pad, cy + H * 0.5 + H * 0.12),
                                         H * 0.3, fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(H * 0.07))
    im.paste((40, 18, 8, 255), (0, 0), sh)

    # 2) 몸통: 원통 느낌 세로 그라데이션 (위쪽에 빛)
    leather = _vgrad(W2, H, [(0, "#060607"), (0.12, "#1E1F23"), (0.27, "#55585F"), (0.35, "#34363C"),
                             (0.62, "#18191C"), (0.88, "#09090B"), (1, "#030304")])
    body = Image.new("L", (W2, H2), 0)
    ImageDraw.Draw(body).rectangle((mx, pad, L + pad, pad + H), fill=255)
    layer = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    layer.paste(leather, (0, pad))
    im.paste(layer, (0, 0), body)

    # 가죽 결 (자잘한 점)
    import random as _r
    rnd = _r.Random(4)
    grain = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))  # 따로 그려서 겹치기 (바로 그리면 투명 구멍이 남)
    gd = ImageDraw.Draw(grain)
    for _ in range(int(L * H / 900)):
        x, y = rnd.uniform(mx + rx * 0.3, L), rnd.uniform(pad + 2, pad + H - 2)
        rr = rnd.uniform(0.6, 1.6) * ss
        gd.ellipse((x - rr, y - rr, x + rr, y + rr), fill=(150, 150, 160, rnd.randint(6, 16)))
    im = Image.alpha_composite(im, grain)
    d = ImageDraw.Draw(im)

    # 3) 금색 띠 2줄 (입구와 같은 타원 모양으로 휘어짐) + 바느질
    gold = _vgrad(W2, H, [(0, "#1A1B1E"), (0.22, "#5A5D64"), (0.32, "#8A8E96"), (0.5, "#44474D"),
                          (0.85, "#1D1E21"), (1, "#0E0E10")])  # 짙은 금속 테
    for off, bw in ((H * 0.16, H * 0.05),):
        band = Image.new("L", (W2, H2), 0)
        bd = ImageDraw.Draw(band)
        bx = mx + off
        bd.ellipse((bx - rx, pad, bx + rx, pad + H), fill=255)
        bd.ellipse((bx - rx - bw, pad, bx + rx - bw, pad + H), fill=0)
        bd.rectangle((0, 0, bx - rx * 0.05 - bw, H2), fill=0)  # 오른쪽 반만 보임
        g = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
        g.paste(gold, (0, pad))
        im.paste(g, (0, 0), band)
    import math as _m
    for yy in (pad + H * 0.12, pad + H * 0.88):  # 바느질: 몸통을 따라 빨간 실
        x = mx + H * 0.3
        while x < L:
            d.line((x, yy, x + H * 0.07, yy), fill=(200, 40, 45, 230), width=max(int(ss * 1.4), 2))
            x += H * 0.12
    # 4) 위쪽 반짝임
    hl = Image.new("L", (W2, H2), 0)
    ImageDraw.Draw(hl).rounded_rectangle((mx + H * 0.6, cy - H * 0.27, L, cy - H * 0.2), H * 0.04, fill=110)
    hl = hl.filter(ImageFilter.GaussianBlur(H * 0.025))
    im.paste((225, 230, 240, 255), (0, 0), hl)

    # 5) 입구: 금색 테두리 + 두께 있는 가죽 입술 + 깊은 안쪽
    d = ImageDraw.Draw(im)
    lip = H * 0.075
    d.ellipse((mx - rx, pad, mx + rx, pad + H), fill="#1A1B1E")
    rim = Image.new("L", (W2, H2), 0)
    rd = ImageDraw.Draw(rim)
    rd.ellipse((mx - rx, pad, mx + rx, pad + H), fill=255)
    rd.ellipse((mx - rx + lip * 0.55, pad + lip, mx + rx - lip * 0.55, pad + H - lip), fill=0)
    g = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    g.paste(gold, (0, pad))
    im.paste(g, (0, 0), rim)
    inner = (mx - rx + lip * 0.55, pad + lip, mx + rx - lip * 0.55, pad + H - lip)
    d.ellipse(inner, fill="#040405")
    glow = Image.new("L", (W2, H2), 0)  # 안쪽 벽에 비치는 빛 (오른쪽 아래)
    ImageDraw.Draw(glow).ellipse((mx - rx * 0.1, cy, mx + rx * 0.7, pad + H - lip * 1.6), fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(H * 0.05))
    inner_mask = Image.new("L", (W2, H2), 0)
    ImageDraw.Draw(inner_mask).ellipse(inner, fill=255)
    from PIL import ImageChops
    im.paste((70, 72, 80, 255), (0, 0), ImageChops.multiply(glow, inner_mask))

    out = im.resize((W2 // ss, H2 // ss), Image.LANCZOS)
    res = (ImageTk.PhotoImage(out), mx / ss, pad / ss)
    if len(_cup_cache) > 6:
        _cup_cache.clear()
    _cup_cache[key] = res
    return res


_tray_cache = {}


def tray_image(geo):
    """주사위 트레이를 한 장의 매끈한 그림으로. 반환: (이미지, 왼쪽 x, 위쪽 y)
    계단처럼 층진 금속 테두리 + 위쪽 짙은 금속 받침대에 파인 주사위 칸 + 빨간 펠트."""
    x0, y0, x1, y1 = geo["tray"]
    key = (tuple(round(v) for v in geo["tray"]), tuple(round(v) for v in geo["felt"]), round(geo["s"], 1))
    if key in _tray_cache:
        return _tray_cache[key]
    from PIL import ImageChops
    ss = 2
    pad = 24
    ox, oy = x0 - pad, y0 - pad
    Wt, Ht = int((x1 - x0 + 2 * pad + 14) * ss), int((y1 - y0 + 2 * pad + 20) * ss)

    def P(x, y):
        return (x - ox) * ss, (y - oy) * ss

    def box(a, b, c, d):
        return (*P(a, b), *P(c, d))

    def soft(mask, radius):
        """크게 흐리기: 작게 줄여서 흐린 뒤 다시 키움 (빠름)."""
        q = 4
        small = mask.resize((max(Wt // q, 1), max(Ht // q, 1)), Image.BILINEAR)
        return small.filter(ImageFilter.GaussianBlur(radius / q)).resize((Wt, Ht), Image.BILINEAR)

    def fill_grad(im, bx, radius, stops):
        """둥근 사각형 영역을 세로 그라데이션으로 칠함."""
        m = Image.new("L", (Wt, Ht), 0)
        ImageDraw.Draw(m).rounded_rectangle(bx, radius, fill=255)
        h = max(int(bx[3] - bx[1]), 2)
        g = Image.new("RGBA", (Wt, Ht))
        g.paste(_vgrad(Wt, h, stops), (0, int(bx[1])))
        im.paste(g, (0, 0), m)

    im = Image.new("RGBA", (Wt, Ht), (0, 0, 0, 0))
    # 1) 나무 위 그림자
    sm = Image.new("L", (Wt, Ht), 0)
    ImageDraw.Draw(sm).rounded_rectangle(box(x0 + 8, y0 + 14, x1 + 8, y1 + 14), 30 * ss, fill=170)
    im.paste((45, 20, 8, 255), (0, 0), soft(sm, 10 * ss))

    # 2) 층진 금속 테두리: 바깥 은색 -> 홈 -> 밝은 계단 -> 어두운 계단 -> 안쪽 턱
    fx0, fy0, fx1, fy1 = geo["felt"]
    rim = fx0 - x0
    layers = [  # (안쪽으로 들어간 비율, 모서리 반지름, 색 그라데이션)
        (0.0, 26, [(0, "#FBFCFD"), (0.1, "#DCE1E6"), (0.55, "#AEB5BD"), (1, "#6B7178")]),
        (0.16, 23, [(0, "#4C5259"), (1, "#2C3035")]),
        (0.24, 21, [(0, "#E9EDF1"), (0.5, "#B8BEC5"), (1, "#7E848B")]),
        (0.52, 18, [(0, "#5E646B"), (1, "#3A3F45")]),
        (0.62, 17, [(0, "#C9CED4"), (1, "#7C8289")]),
        (0.8, 15, [(0, "#2A2D32"), (1, "#1B1D21")]),
    ]
    for f, r, stops in layers:
        i = rim * f
        fill_grad(im, box(x0 + i, y0 + i, x1 - i, y1 - i), r * ss, stops)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(box(x0 + 1, y0 + 1, x1 - 1, y1 - 1), 26 * ss, outline=(255, 255, 255, 210), width=ss)

    # 3) 펠트: 은은한 결 + 가장자리 안쪽 그림자
    felt_mask = Image.new("L", (Wt, Ht), 0)
    ImageDraw.Draw(felt_mask).rounded_rectangle(box(fx0, fy0, fx1, fy1), 12 * ss, fill=255)
    felt = Image.new("RGBA", (Wt, Ht), FELT)
    noise = Image.effect_noise((Wt, Ht), 22).point(lambda v: max(0, min(255, (v - 128) // 3 + 128)))
    felt = Image.blend(felt, Image.merge("RGBA", (noise, noise, noise, Image.new("L", (Wt, Ht), 255))), 0.06)
    im.paste(felt, (0, 0), felt_mask)
    inner = Image.new("L", (Wt, Ht), 255)
    ImageDraw.Draw(inner).rounded_rectangle(box(fx0 + 2, fy0 + 5, fx1 - 2, fy1 - 1), 12 * ss, fill=0)
    inner = soft(inner, 8 * ss)
    im.paste((50, 4, 8, 255), (0, 0), ImageChops.multiply(inner, felt_mask).point(lambda v: v * 0.8))

    # 4) 위쪽 받침대: 짙은 금속 블록 + 파인 주사위 칸
    s = geo["s"]
    sx0, sy0, sx1, sy1 = geo["shelf"]
    sb = box(sx0, sy0, sx1, sy1)
    shelf_mask = Image.new("L", (Wt, Ht), 0)
    sd = ImageDraw.Draw(shelf_mask)
    sd.rounded_rectangle(sb, 12 * ss, fill=255)
    sd.rectangle((sb[0], sb[1] + 12 * ss, sb[2], sb[3]), fill=255)  # 아래쪽 모서리는 각지게 펠트와 이어짐
    g = Image.new("RGBA", (Wt, Ht))
    g.paste(_vgrad(Wt, max(int(sb[3] - sb[1]), 2), [(0, "#565B62"), (0.5, "#3D4147"), (1, "#2B2E33")]),
            (0, int(sb[1])))
    im.paste(g, (0, 0), shelf_mask)
    sh = Image.new("L", (Wt, Ht), 0)  # 받침대가 펠트에 드리우는 그림자
    ImageDraw.Draw(sh).rectangle((sb[0], sb[3], sb[2], sb[3] + 6 * ss), fill=150)
    sh = ImageChops.multiply(soft(sh, 3 * ss), felt_mask)
    im.paste((40, 2, 6, 255), (0, 0), sh)
    d = ImageDraw.Draw(im)
    d.line((sb[0] + 10 * ss, sb[3] - ss, sb[2] - 10 * ss, sb[3] - ss), fill=(140, 147, 156, 255), width=ss)
    for cx, cy in geo["slots"]:  # 칸마다 작은 조각에서만 계산 (빠르게)
        b = box(cx - s * 0.6, cy - s * 0.56, cx + s * 0.6, cy + s * 0.56)
        r = s * 0.16 * ss
        m = int(8 * ss)
        cx0, cy0 = int(b[0]) - m, int(b[1]) - m
        cw, ch = int(b[2] - b[0]) + 2 * m, int(b[3] - b[1]) + 2 * m
        lb = (b[0] - cx0, b[1] - cy0, b[2] - cx0, b[3] - cy0)
        piece = im.crop((cx0, cy0, cx0 + cw, cy0 + ch))
        well = Image.new("L", (cw, ch), 0)
        ImageDraw.Draw(well).rounded_rectangle(lb, r, fill=255)
        g = Image.new("RGBA", (cw, ch))
        g.paste(_vgrad(cw, int(lb[3] - lb[1]) + 1, [(0, "#16181B"), (0.6, "#24272C"), (1, "#30343A")]),
                (0, int(lb[1])))
        piece.paste(g, (0, 0), well)
        top = Image.new("L", (cw, ch), 255)  # 안쪽 위 그림자
        ImageDraw.Draw(top).rounded_rectangle((lb[0] + 2 * ss, lb[1] + 5 * ss, lb[2] - 2 * ss, lb[3] + 5 * ss), r,
                                              fill=0)
        top = ImageChops.multiply(top.filter(ImageFilter.GaussianBlur(2.5 * ss)), well)
        piece.paste((5, 5, 7, 255), (0, 0), top)
        lip = Image.new("L", (cw, ch), 0)  # 아래쪽 밝은 턱
        ImageDraw.Draw(lip).rounded_rectangle((lb[0], lb[1] + 1.5 * ss, lb[2], lb[3] + 1.5 * ss), r, fill=150)
        ImageDraw.Draw(lip).rounded_rectangle(lb, r, fill=0)
        piece.paste((170, 177, 186, 255), (0, 0), lip)
        im.paste(piece, (cx0, cy0))
    out = im.resize((Wt // ss, Ht // ss), Image.LANCZOS)
    res = (ImageTk.PhotoImage(out), ox, oy)
    if len(_tray_cache) > 4:
        _tray_cache.clear()
    _tray_cache[key] = res
    return res


def round_rect(cv, x0, y0, x1, y1, r, **kw):
    r = max(min(r, (x1 - x0) / 2, (y1 - y0) / 2), 0)
    pts = [x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r, x1, y1 - r, x1, y1,
           x1 - r, y1, x0 + r, y1, x0, y1, x0, y1 - r, x0, y0 + r, x0, y0]
    return cv.create_polygon(pts, smooth=True, **kw)


def make_button(parent, text, command, bg, on_bg=None):
    """둥근 알약 버튼 (맥에서도 같은 색). on_bg가 없으면 뒤에 배경 그라데이션."""
    return ui_kit.RoundButton(parent, text, command, bg=bg, font=(UI_FONT, 10, BOLD), on_bg=on_bg, padx=16, pady=7)


def draw_die(cv, cx, cy, size, face, held=False, angle=0.0, empty=False, tags=(), shadow=None):
    """(cx, cy) 중심에 입체감 있는 주사위를 그림. angle은 라디안."""
    half, rad = size / 2, size * 0.22
    pts = []
    for qx, qy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):  # 모서리마다 호
        ox, oy = qx * (half - rad), qy * (half - rad)
        for k in range(7):
            a = math.radians(a0 + k * 15)
            pts.append((ox + rad * math.cos(a), oy + rad * math.sin(a)))
    cos, sin = math.cos(angle), math.sin(angle)

    def poly(dx=0.0, dy=0.0, scale=1.0):
        return [v for x, y in pts for v in (cx + dx + (x * cos - y * sin) * scale,
                                            cy + dy + (x * sin + y * cos) * scale)]

    cv.create_polygon(poly(size * 0.06, size * 0.11), fill=shadow or blend(PANEL, "#000000", 0.45), outline="",
                      tags=tags)
    if empty:
        cv.create_polygon(poly(), fill=CARD, outline=blend(CARD, "#FFFFFF", 0.12), width=2, tags=tags)
        cv.create_text(cx, cy, text="?", fill=MUTED, font=(UI_FONT, -int(size * 0.4), BOLD), tags=tags)
        return
    cv.create_polygon(poly(0, size * 0.07), fill="#CFC6B4" if not held else "#B8A6F5", outline="", tags=tags)
    cv.create_polygon(poly(), fill="#F4F0E8" if not held else "#EEE8FF",
                      outline=ACCENT if held else "#E2DBCD", width=max(size * 0.05, 2.5) if held else 1, tags=tags)
    cv.create_polygon(poly(-size * 0.03, -size * 0.04, 0.8), fill="#FFFFFF" if not held else "#F8F5FF", outline="",
                      tags=tags)
    pr, step = size * 0.092, size * 0.26
    color = "#C7302E" if face == 1 else "#1F1C19"
    for px, py in PIPS[face]:
        x = cx + (px * step) * cos - (py * step) * sin
        y = cy + (px * step) * sin + (py * step) * cos
        r = pr * (1.55 if face == 1 else 1)
        cv.create_oval(x - r, y - r, x + r, y + r, fill=color, outline="", tags=tags)


class YachtApp:
    def __init__(self, root, parent=None, preset=None, on_back=None):
        """parent/preset/on_back은 미니게임룸에서 열 때 사용 (단독 실행이면 생략)."""
        self.root = root
        self.alive = True
        setup_fonts(root)
        host = parent or root
        if parent is None:
            root.title("야추 다이스")
            root.configure(bg=BG)
            root.geometry("1240x800")
            root.minsize(1100, 700)
            root.protocol("WM_DELETE_WINDOW", self.on_close)

        self.mode_var = tk.StringVar(value="local")
        self.level = (preset or {}).get("level", "normal")  # 컴퓨터 난이도
        self.count_var = tk.StringVar(value="2")
        self.name_var = tk.StringVar(value="플레이어")

        self.role = None  # None(혼자/한 PC) / "host" / "guest"
        self.conn = None  # 참가자: 방장과의 연결
        self.server = None
        self.guests = []  # 방장: [{"conn", "name", "seat"}]
        self.specs = []  # 방장: 관전자 [{"conn", "name"}]
        self.spectating = False  # 나는 관전자
        self.spec_count = 0
        self.spec_names = []  # 관전자 이름 (방장이 알려 줌)
        self.started = False  # 네트워크 게임 시작 여부
        self.my_seat = 0
        self.net_queue = queue.Queue()

        self.game = None
        self.shown_roll_id = 0
        self.anim = None  # 주사위가 굴러가는 중이면 dict
        self.ai_pending = False
        self.result_shown = False
        self.table_key = None
        self.dice = [{"visible": False, "u": 0.5, "v": 0.5, "x": 0, "y": 0, "a": 0.0, "face": 1, "rolling": False}
                     for _ in range(5)]
        self.shake = None  # 컵을 흔드는 중이면 시작 시각
        self.throw_power = 1.0
        self.loop_on = False
        self.last_t = time.monotonic()
        self.geo = None
        self.sheet_x = self.sheet_tx = 0.0  # 점수표 옆 스크롤 (현재, 목표)
        self.sheet_focus = self.sheet_players = None
        self.sheet_hover = None
        self.tip = self.tip_job = None
        self.my_avatar = (preset or {}).get("avatar")
        self.avatars = []  # 자리 번호별 프로필 그림
        self.on_result = (preset or {}).get("on_result")  # 미니게임룸: 누적 랭킹 기록
        self.fx_bubbles = {}  # 자리 -> (멘트, 사라질 시각)
        self.teabag = None
        self.emote_opts, self.result_comment, self.tally_text = [], [], ""
        self.podium = {}
        self.last_emote = 0.0

        self.surface = ui_kit.Surface(host)  # 창 전체 배경
        self.surface.pack(fill="both", expand=True)
        host = self.surface
        # 위쪽 막대
        bar = ui_kit.Surface(host, height=44)
        bar.pack(fill="x", padx=16, pady=(12, 0))
        if on_back:
            make_button(bar, "←  메뉴로", on_back, CARD).pack(side="left")
        else:
            self._segment(bar, "모드", self.mode_var, [("local", "한 PC"), ("ai", "컴퓨터"), ("net", "네트워크")])
            self._segment(bar, "인원", self.count_var, [(str(n), str(n)) for n in range(2, 7)])
            tk.Label(bar, text="이름", bg=BG, fg=MUTED, font=(UI_FONT, 9)).pack(side="left", padx=(10, 4))
            tk.Entry(bar, textvariable=self.name_var, width=10, font=(UI_FONT, 10), relief="flat", bg=CARD,
                     fg=TEXT, insertbackground=TEXT).pack(side="left", ipady=4)
        self.new_btn = make_button(bar, "새 게임", self.new_game, ACCENT)
        self.new_btn.pack(side="left", padx=(10, 0))
        make_button(bar, "항복", self.resign, DANGER).pack(side="left", padx=(6, 0))
        status_card = ui_kit.Card(bar, radius=20, pad=8)
        status_card.pack(side="right")
        self.status_label = tk.Label(status_card.body, bg=PANEL, fg=TEXT, font=(UI_FONT, 13, BOLD))
        self.status_label.pack(padx=8)
        self.popups, self.chat_toasts, self.unread, self.chat_open = [], [], 0, False
        if chat is not None:
            self.chat_btn = make_button(bar, "채팅", self.toggle_chat, CARD)
            self.chat_btn.pack(side="left", padx=(10, 0))
            self.sticker_bar = tk.Canvas(bar, width=len(chat.STICKERS) * 34, height=34, bg=BG, highlightthickness=0,
                                         cursor="hand2")
            self.sticker_bar.pack(side="left", padx=(10, 0))
            self.sticker_bar.bind("<Configure>", lambda e: ui_kit.paint_backdrop(self.sticker_bar))
            self.bar = bar
            bar.bind("<Configure>", lambda e: self.fit_bar(), add="+")
            for k, (sid, _) in enumerate(chat.STICKERS):
                chat.draw_sticker(self.sticker_bar, 17 + k * 34, 17, 28, sid)
            self.sticker_bar.bind("<Button-1>", lambda e: self.on_sticker_bar(e.x))

        body = ui_kit.Surface(host)
        body.pack(fill="both", expand=True, padx=16, pady=12)
        self.sheet = tk.Canvas(body, bg=CELL, highlightthickness=0, width=self.SHEET_CAT_W + 2 * self.SHEET_COL_W)
        self.sheet.pack(side="left", fill="y")
        self.sheet.bind("<Configure>", lambda e: self.draw_sheet())
        self.sheet.bind("<Motion>", self.on_sheet_motion)
        self.sheet.bind("<Leave>", self.on_sheet_leave)
        self.sheet.bind("<Button-1>", self.on_sheet_click)
        self.sheet.bind("<MouseWheel>", self.on_sheet_wheel)
        self.sheet.bind("<Shift-MouseWheel>", self.on_sheet_wheel)
        self.sheet.bind("<Button-4>", self.on_sheet_wheel)
        self.sheet.bind("<Button-5>", self.on_sheet_wheel)
        self.cv = tk.Canvas(body, bg=WOOD, highlightthickness=0)
        self.cv.pack(side="left", fill="both", expand=True, padx=(14, 0))
        self.chat_panel = None
        if chat is not None:
            # 오른쪽 칸: 참가자 현황 + 채팅 (채팅 버튼으로 열고 닫음)
            self.side_col = ui_kit.Surface(body, width=280)
            self.side_col.pack_propagate(False)
            self.people_card = ui_kit.PeopleCard(self.side_col, UI_FONT, BOLD)
            self.chat_card = ui_kit.Card(self.side_col, stretch=True)
            self.chat_card.pack(side="bottom", fill="both", expand=True)
            self.chat_panel = chat.ChatPanel(self.chat_card.body, (PANEL, CARD, TEXT, MUTED, ACCENT), UI_FONT, BOLD,
                                             self.send_chat, self.send_sticker, lines=6)
            self.chat_panel.pack(fill="both", expand=True)
        self.cv.bind("<Configure>", lambda e: self.layout())
        self.cv.bind("<ButtonPress-1>", self.on_press)
        self.cv.bind("<ButtonRelease-1>", self.on_release)
        self.emote_hits = []  # 결과 화면 버튼 영역 (x0, y0, x1, y1, 할 일)

        self.root.after(100, self.poll_net)
        if preset and preset.get("mode") == "net" and self.chat_panel:
            self.root.after(300, lambda: self.chat_open or self.toggle_chat())
        if preset:
            self.mode_var.set(preset.get("mode", "local"))
            self.count_var.set(str(preset.get("count", 2)))
            self.name_var.set(preset.get("name") or "플레이어")
            if preset.get("mode") == "net":
                self.avatars = [self.my_avatar]
                self.start_game(YachtGame([self.name_var.get()]))  # 접속 전 빈 점수표
                if preset.get("net") in ("join", "watch"):
                    self.join(preset.get("ip", ""), spectate=preset.get("net") == "watch")
                else:
                    self.host()
                return
        self.new_game()

    def shutdown(self):
        """미니게임룸에서 화면을 떠날 때: 반복 작업과 연결을 정리."""
        self.alive = False
        self.hide_tip()
        self.close_net()

    def _segment(self, parent, label, var, options):
        tk.Label(parent, text=label, bg=BG, fg=MUTED, font=(UI_FONT, 9)).pack(side="left", padx=(10, 4))
        cells = {}

        def paint(*_):
            for value, cell in cells.items():
                on = var.get() == value
                cell.config(bg=ACCENT if on else CARD, fg="white" if on else TEXT)

        for value, text in options:
            cell = tk.Label(parent, text=text, font=(UI_FONT, 10, BOLD), padx=8, pady=5, cursor="hand2")
            cell.pack(side="left", padx=(0, 2))
            cell.bind("<Button-1>", lambda e, v=value: var.set(v))
            cells[value] = cell
        var.trace_add("write", paint)
        paint()

    # ---- 게임 시작
    def new_game(self):
        mode = self.mode_var.get()
        if mode == "net":
            if self.role == "host":
                self.start_net_game()
            elif self.role == "guest" and self.conn:
                messagebox.showinfo("야추", "방장만 새 게임을 시작할 수 있어요.")
            else:
                self.open_net_dialog()
            return
        self.close_net()
        n = int(self.count_var.get())
        me = self.name_var.get().strip() or "플레이어"
        if mode == "ai":
            self.avatars = [self.my_avatar] + [{"type": "animal", "id": "robot"}] * (n - 1)
            self.start_game(YachtGame([me] + [f"컴퓨터 {i}" for i in range(1, n)], ai=set(range(1, n))))
        else:
            self.avatars = [None] * n  # 기본 동물이 순서대로
            self.start_game(YachtGame([f"플레이어 {i + 1}" for i in range(n)]))

    def start_game(self, game, seat=0):
        self.game = game
        self.my_seat = seat
        self.shown_roll_id = game.roll_id
        self.anim = None
        self.result_shown = False
        for d in self.dice:
            d["visible"] = d["rolling"] = False
        self.after_change()

    # ---- 행동 처리
    def can_act(self):
        g = self.game
        if not g or g.over or self.anim:
            return False
        if g.players[g.current]["ai"]:
            return False
        if self.role in ("host", "guest"):
            return self.started and g.current == self.my_seat
        return True

    def act(self, action, **kw):
        """화면에서 누른 행동. 참가자는 방장에게 보내고, 나머지는 바로 적용."""
        if not self.can_act():
            return
        if action == "roll" and self.game.rolls_left == 0:
            return
        if self.role == "guest":
            send_json(self.conn, {"type": "act", "act": action, **kw})
        else:
            self.do_action(self.game.current, action, **kw)

    def do_action(self, seat, action, i=None, cat=None):
        g = self.game
        if g and action == "resign":
            if g.resign(seat):
                self.toast(f"{g.players[seat]['name']}님이 항복했어요")
                self.after_change()
            return
        if not g or seat != g.current:
            return
        ok = {"roll": lambda: g.roll(), "hold": lambda: g.toggle(int(i)),
              "score": lambda: cat in CATEGORIES and g.record(cat)}.get(action, lambda: False)()
        if ok:
            self.after_change()

    def after_change(self):
        if self.role == "host":
            self.broadcast_state()
        self.render()
        if self.game.over and not self.result_shown:
            self.result_shown = True
            if party is not None:
                self.on_game_over()
            else:
                self.root.after(900, self.show_result)
        self.schedule_ai()

    def show_result(self):
        if not self.alive:
            return
        g = self.game
        lines = [f"{rank}위  {g.players[i]['name']}  {g.total(g.players[i])}점" for rank, i in enumerate(g.ranking(), 1)]
        messagebox.showinfo("게임 종료", "\n".join(lines))

    # ---- 컴퓨터 (컴퓨터 대전, 네트워크에서 나간 사람 대신)
    def schedule_ai(self):
        g = self.game
        if self.role == "guest" or not g or g.over or self.ai_pending:
            return
        if g.players[g.current]["ai"]:
            self.ai_pending = True
            self.root.after(ROLL_MS + 450, self.ai_step)

    def ai_step(self):
        self.ai_pending = False
        if not self.alive:
            return
        g = self.game
        if not g or g.over or not g.players[g.current]["ai"]:
            return
        if self.anim:
            self.schedule_ai()
            return
        if not g.rolled:
            self.throw_power = random.uniform(0.9, 1.15)
            self.do_action(g.current, "roll")
        elif g.rolls_left > 0 and not ai_should_stop(g):
            holds = ai_holds(g)
            if self.level == "easy" and random.random() < 0.4:  # 쉬움: 고정을 대충
                holds = [random.random() < 0.3 for _ in range(5)]
            if holds != g.held:
                g.held = holds  # 고정을 먼저 보여 주고 다음 단계에서 굴림
                self.after_change()
            else:
                self.throw_power = random.uniform(0.9, 1.15)
                self.do_action(g.current, "roll")
        else:
            self.do_action(g.current, "score", cat=ai_pick_category(g, self.level))

    # ---- 입력: 컵을 꾹 눌러 흔들고 놓으면 던짐, 주사위를 누르면 고정
    def on_press(self, event):
        geo = self.geo
        if not geo or not self.game:
            return
        x, y = event.x, event.y
        if self.game.over:
            for x0, y0, x1, y1, action in self.emote_hits:
                if x0 <= x <= x1 and y0 <= y <= y1:
                    action()
                    return
        bx0, by0, bx1, by1 = geo["button"]
        if bx0 <= x <= bx1 and by0 <= y <= by1:
            self.on_big_button()
            return
        cx0, cy0, cx1, cy1 = geo["cup_box"]
        if cx0 <= x <= cx1 and cy0 <= y <= cy1:
            if self.can_roll():
                self.shake = time.monotonic()
                self.ensure_loop()
            return
        s = geo["s"]
        for i, d in enumerate(self.dice):
            if d["visible"] and not d["rolling"] and (x - d["x"]) ** 2 + (y - d["y"]) ** 2 <= (s * 0.62) ** 2:
                self.act("hold", i=i)
                return

    def on_release(self, event):
        if self.shake is not None:
            held_for = time.monotonic() - self.shake
            self.shake = None
            self.throw(min(0.8 + held_for * 0.5, 1.45))

    def can_roll(self):
        return self.can_act() and self.game.rolls_left > 0

    def throw(self, power):
        if self.can_roll():
            self.throw_power = power
            self.act("roll")
        self.redraw_dyn()

    def on_big_button(self):
        g = self.game
        if self.in_lobby():
            if self.role == "host" and self.guests:
                self.start_net_game()
        elif g.over:
            if self.role != "guest":
                self.new_game()
        elif self.can_roll() and self.shake is None:
            self.shake = time.monotonic()  # 버튼: 잠깐 흔든 뒤 자동으로 던짐
            self.ensure_loop()
            self.root.after(420, self._auto_throw)

    def _auto_throw(self):
        if self.alive and self.shake is not None:
            self.shake = None
            self.throw(random.uniform(1.0, 1.25))

    def on_cell(self, j, cat):
        g = self.game
        if g and j == g.current and g.rolled and cat not in g.players[j]["scores"]:
            self.act("score", cat=cat)

    # ---- 상태 -> 화면
    def render(self):
        g = self.game
        if not g:
            return
        if g.roll_id != self.shown_roll_id:
            self.shown_roll_id = g.roll_id
            if g.rolled:
                self.start_throw([i for i in range(5) if not g.held[i]])
        if not g.rolled:
            self.anim = None
            for d in self.dice:
                d["visible"] = d["rolling"] = False  # 새 차례: 주사위는 컵 안에
        self.update_table()
        self.update_status()
        self.redraw_dyn()
        self.ensure_loop()

    def update_labels(self):  # 네트워크 코드에서 부름
        self.update_status()
        self.redraw_dyn()

    def draw_dice(self):  # 네트워크 코드에서 부름
        self.redraw_dyn()

    def update_status(self):
        g = self.game
        if self.in_lobby():
            n = len(self.lobby_names())
            text = f"대기실 · {n}명" if n else "접속 중..."
        elif g.over:
            best = g.players[g.ranking()[0]]
            text = f"★ {best['name']} 승리!  {g.total(best)}점"
        else:
            text = f"라운드 {g.round} / 12"
        if self.spectating:
            text = "관전 중  ·  " + text
        self.status_label.config(text=text, fg=GOLD if g.over else TEXT)
        self.update_people()
        self.new_btn.config(text=f"게임 시작 ({len(self.guests) + 1}명)"
                            if self.role == "host" and not self.started else "새 게임")

    def update_people(self):
        """네트워크 게임일 때 채팅 위에 참가자(자리 순서)와 관전자 목록."""
        card = getattr(self, "people_card", None)
        if card is None:
            return
        if not self.role:
            card.pack_forget()
            return
        g = self.game
        players = []
        if self.in_lobby() or not g:
            for i, name in enumerate(self.lobby_names()):
                players.append((self.avatars[i] if i < len(self.avatars) else None,
                                name + ("  (나)" if i == self.my_seat and not self.spectating else ""),
                                "방장" if i == 0 else "", False))
        else:
            for i, p in enumerate(g.players):
                turn = i == g.current and not g.over
                players.append((self.avatars[i] if i < len(self.avatars) else None,
                                p["name"] + ("  (나)" if i == self.my_seat and not self.spectating else ""),
                                ("차례  ·  " if turn else "") + f"{g.total(p)}점", turn))
        specs = [x["name"] for x in self.specs] if self.role == "host" else list(self.spec_names)
        if self.spectating and self.name_var.get() not in specs:
            specs.append(self.name_var.get())
        if not card.winfo_ismapped():
            card.pack(side="top", fill="x", pady=(0, 10), before=self.chat_card)
        card.update_people(players, specs)

    # ---- 주사위 물리
    def start_throw(self, rolling):
        geo = self.geo
        now = time.monotonic()
        sfx("roll")
        for k, i in enumerate(rolling):
            d = self.dice[i]
            d.update(visible=True, rolling=True, final=self.game.dice[i], spawn=now + k * 0.05,
                     a=random.uniform(0, math.tau), va=random.uniform(-16, 16), travel=0.0,
                     face=random.randint(1, 6))
            if geo:
                ax0, ay0, ax1, ay1 = geo["area"]
                d["x"] = ax1 - geo["s"] * 0.7
                d["y"] = random.uniform(ay0 + (ay1 - ay0) * 0.3, ay1 - (ay1 - ay0) * 0.3)
                speed = (ax1 - ax0) * random.uniform(1.6, 2.3) * self.throw_power
                d["vx"], d["vy"] = -speed, random.uniform(-0.9, 0.9) * (ay1 - ay0)
            else:
                d.update(x=0, y=0, vx=0, vy=0)
        self.anim = {"t0": now} if rolling else None
        self.ensure_loop()

    def step_physics(self, dt):
        geo = self.geo
        if not geo or not self.anim:
            return
        ax0, ay0, ax1, ay1 = geo["area"]
        s = geo["s"]
        r = s * 0.5
        now = time.monotonic()
        rolling = [d for d in self.dice if d["rolling"] and now >= d.get("spawn", 0)]
        for d in rolling:
            d["x"] += d["vx"] * dt
            d["y"] += d["vy"] * dt
            d["a"] += d["va"] * dt
            fr = math.exp(-1.9 * dt)
            d["vx"] *= fr
            d["vy"] *= fr
            d["va"] *= math.exp(-2.4 * dt)
            for axis, lo, hi in (("x", ax0 + r, ax1 - r), ("y", ay0 + r, ay1 - r)):
                v = "v" + axis
                if d[axis] < lo or d[axis] > hi:
                    d[axis] = min(max(d[axis], lo), hi)
                    d[v] = -d[v] * 0.55
                    d["va"] += random.uniform(-8, 8)
            speed = math.hypot(d["vx"], d["vy"])
            d["travel"] += speed * dt
            if speed > 90 and d["travel"] > s * 0.75:  # 구르며 윗면이 바뀌는 느낌
                d["travel"] = 0.0
                d["face"] = random.randint(1, 6)
        for i, a in enumerate(rolling):  # 주사위끼리 부딪힘
            for b in rolling[i + 1:]:
                dx, dy = b["x"] - a["x"], b["y"] - a["y"]
                dist = math.hypot(dx, dy) or 0.01
                if dist < s * 0.95:
                    nx, ny = dx / dist, dy / dist
                    push = (s * 0.95 - dist) / 2
                    a["x"] -= nx * push
                    a["y"] -= ny * push
                    b["x"] += nx * push
                    b["y"] += ny * push
                    rel = (b["vx"] - a["vx"]) * nx + (b["vy"] - a["vy"]) * ny
                    if rel < 0:
                        imp = -rel * 0.9
                        a["vx"] -= nx * imp
                        a["vy"] -= ny * imp
                        b["vx"] += nx * imp
                        b["vy"] += ny * imp
                        a["va"] += random.uniform(-6, 6)
                        b["va"] += random.uniform(-6, 6)
        force = now - self.anim["t0"] > MAX_ROLL_S
        for d in rolling:
            if force or (math.hypot(d["vx"], d["vy"]) < 30 and abs(d["va"]) < 0.6):
                d["rolling"] = False
                d["face"] = d["final"]
                d["u"] = (d["x"] - ax0) / (ax1 - ax0)
                d["v"] = (d["y"] - ay0) / (ay1 - ay0)
        if not any(d["rolling"] for d in self.dice):
            self.anim = None
            self.update_table()
            self.update_status()

    def ensure_loop(self):
        if not self.loop_on and self.alive:
            self.loop_on = True
            self.last_t = time.monotonic()
            self.root.after(16, self.loop)

    def loop(self):
        if not self.alive:
            self.loop_on = False
            return
        now = time.monotonic()
        dt = min(now - self.last_t, 0.05)
        self.last_t = now
        self.step_physics(dt)
        moving = self.update_held_positions(dt)
        scrolling = self.sheet_step(dt)
        self.redraw_dyn()
        if self.anim or self.shake is not None or moving or scrolling or self.fx_active() or self.chat_fx_active():
            self.root.after(16, self.loop)
        else:
            self.loop_on = False

    def update_held_positions(self, dt):
        """고정한 주사위는 위 칸으로, 푼 주사위는 원래 자리로 부드럽게 이동. 아직 움직이면 True."""
        geo, g = self.geo, self.game
        if not geo or not g:
            return False
        ax0, ay0, ax1, ay1 = geo["area"]
        moving = False
        k = 1 - math.exp(-dt * 16)
        for i, d in enumerate(self.dice):
            if not d["visible"] or d["rolling"]:
                continue
            if g.held[i] and g.rolled:
                tx, ty = geo["slots"][i]
                ta = 0.0
            else:
                tx, ty = ax0 + d["u"] * (ax1 - ax0), ay0 + d["v"] * (ay1 - ay0)
                ta = d["a"]
            if abs(d["x"] - tx) > 0.5 or abs(d["y"] - ty) > 0.5:
                d["x"] += (tx - d["x"]) * k
                d["y"] += (ty - d["y"]) * k
                moving = True
            else:
                d["x"], d["y"] = tx, ty
            if g.held[i] and g.rolled and abs(d["a"]) > 0.01:
                d["a"] -= d["a"] * k  # 고정 칸에서는 반듯하게
                moving = True
        return moving

    # ---- 테이블 그리기
    def layout(self):
        cv = self.cv
        W, H = cv.winfo_width(), cv.winfo_height()
        if W < 50 or H < 50:
            return
        top, bottom = 64, 132
        tw = min(W - 150, (H - top - bottom) * 1.32)
        th = tw / 1.32
        x0 = (W - tw) / 2 - 40
        y0 = top
        rim = tw * 0.045
        fx0, fy0, fx1, fy1 = x0 + rim, y0 + rim, x0 + tw - rim, y0 + th - rim
        shelf_h = (fy1 - fy0) * 0.21
        pad = rim * 0.6
        area = (fx0 + pad, fy0 + shelf_h + pad, fx1 - pad, fy1 - pad)
        s = min((area[2] - area[0]) / 6.2, (area[3] - area[1]) / 3.0, shelf_h * 0.78)
        sx0, sx1 = fx0 + pad, fx1 - pad
        slots = [(sx0 + (sx1 - sx0) * (i + 0.5) / 5, fy0 + shelf_h / 2 + pad * 0.3) for i in range(5)]
        mx, my = fx1 + rim * 0.2, (area[1] + area[3]) / 2
        cup_h = s * 2.1
        self.geo = {"W": W, "H": H, "tray": (x0, y0, x0 + tw, y0 + th), "felt": (fx0, fy0, fx1, fy1),
                    "shelf": (fx0, fy0, fx1, fy0 + shelf_h), "area": area, "s": s, "slots": slots,
                    "cup": (mx, my, cup_h), "cup_box": (mx - cup_h * 0.25, my - cup_h * 0.6, W, my + cup_h * 0.6),
                    "button": (W / 2 - 150 - 40, y0 + th + 26, W / 2 + 150 - 40, y0 + th + 82),
                    "hint_y": y0 + th + 106}
        old = getattr(self, "_old_area", None)
        self._old_area = area
        if old and old != area:  # 창 크기가 바뀌면 굴러가던 주사위 위치도 비율대로
            for d in self.dice:
                if d["rolling"]:
                    d["x"] = area[0] + (d["x"] - old[0]) / (old[2] - old[0]) * (area[2] - area[0])
                    d["y"] = area[1] + (d["y"] - old[1]) / (old[3] - old[1]) * (area[3] - area[1])
        self.draw_static()
        for d in self.dice:
            if d["visible"] and not d["rolling"]:
                self.update_held_positions(10)  # 즉시 제자리로
                break
        self.redraw_dyn()

    def draw_static(self):
        cv, geo = self.cv, self.geo
        cv.delete("all")
        W, H = geo["W"], geo["H"]
        rnd = random.Random(7)
        for y in range(0, H, 3):  # 나무 결
            t = 0.5 + 0.5 * math.sin(y * 0.05 + math.sin(y * 0.013) * 2.2)
            cv.create_rectangle(0, y, W, y + 3, fill=blend(WOOD, "#93592F", t * 0.55), width=0, tags="static")
        for k in range(1, 5):
            y = H * k / 5 + rnd.uniform(-8, 8)
            cv.create_line(0, y, W, y, fill="#7A4825", width=2, tags="static")
        for _ in range(26):
            y = rnd.uniform(0, H)
            pts = []
            for x in range(-20, W + 40, 40):
                pts += [x, y + rnd.uniform(-3, 3)]
            cv.create_line(pts, fill=blend(WOOD, "#6E3F1E", rnd.uniform(0.15, 0.35)), width=1, smooth=True,
                           tags="static")

        x0, y0, x1, y1 = geo["tray"]
        if Image is not None and x1 - x0 > 160 and y1 - y0 > 120:  # 트레이 전체를 매끈한 그림 한 장으로
            try:
                img, ix, iy = tray_image(geo)
            except ValueError:  # 창이 막 열려 크기가 이상할 때는 기본 도형으로
                img = None
            if img is not None:
                cv.create_image(ix, iy, anchor="nw", image=img, tags="static")
                ui_kit.round_corners(cv, 24)
                return
        round_rect(cv, x0 + 10, y0 + 16, x1 + 10, y1 + 18, 34, fill=blend(WOOD, "#000000", 0.45), outline="",
                   tags="static")
        steps = 9
        for k in range(steps):  # 금속 테두리
            inset = k * (geo["felt"][0] - x0) / steps
            round_rect(cv, x0 + inset, y0 + inset, x1 - inset, y1 - inset, 32 - k * 2,
                       fill=blend("#F4F6F8", "#7E858D", k / steps), outline="", tags="static")
        fx0, fy0, fx1, fy1 = geo["felt"]
        for k in range(7):  # 펠트 가장자리가 살짝 어둡게
            inset = k * 3
            round_rect(cv, fx0 + inset, fy0 + inset, fx1 - inset, fy1 - inset, 16,
                       fill=blend("#5E0F14", FELT, min(1, k / 5)), outline="", tags="static")
        sx0, sy0, sx1, sy1 = geo["shelf"]
        round_rect(cv, sx0 + 4, sy0 + 4, sx1 - 4, sy1, 12, fill="#2F3339", outline="", tags="static")
        s = geo["s"]
        for cx, cy in geo["slots"]:
            round_rect(cv, cx - s * 0.66, cy - s * 0.62, cx + s * 0.66, cy + s * 0.62, s * 0.22,
                       fill="#1F2226", outline="#454A52", width=1, tags="static")
        cv.create_line(sx0 + 10, sy1 + 1, sx1 - 10, sy1 + 1, fill="#5E0F14", width=3, tags="static")
        ui_kit.round_corners(cv, 24)

    def draw_cup(self, shake_t):
        cv, geo = self.cv, self.geo
        mx, my, h = geo["cup"]
        jx = jy = 0.0
        if shake_t is not None:
            jx = math.sin(shake_t * 38) * h * 0.06 - h * 0.05
            jy = math.cos(shake_t * 47) * h * 0.08
        mx, my = mx + jx, my + jy
        W = geo["W"]
        x1 = W + 20
        if shake_t is not None and int(shake_t * 5) != getattr(self, "_shake_tick", -1):
            self._shake_tick = int(shake_t * 5)  # 흔드는 동안 달그락
            sfx("shake")
        if Image is not None:  # 매끈한 가죽 컵 이미지
            img, ox, oy = cup_image(W + 30 - geo["cup"][0], h)
            cv.create_image(mx - ox, my - h / 2 - oy, anchor="nw", image=img, tags="dyn")
            if shake_t is not None:  # 흔드는 중: 입구 앞에 들썩이는 선
                for k in range(3):
                    ph = (shake_t * 5 + k / 3) % 1
                    r = h * (0.32 + ph * 0.3)
                    cv.create_arc(mx - r, my - r, mx + r, my + r, start=150, extent=60, style="arc",
                                  outline=blend("#FFF3D6", WOOD, ph), width=max(h * 0.04, 2), tags="dyn")
                cv.create_text(mx + h * 0.15, my - h * 0.72, text="흔드는 중...", anchor="w", fill="#FFE9C9",
                               font=(UI_FONT, 10, BOLD), tags="dyn")
            return
        cv.create_rectangle(mx + 6, my - h / 2 + 14, x1, my + h / 2 + 14, fill=blend(WOOD, "#000000", 0.5),
                            width=0, tags="dyn")
        round_rect(cv, mx, my - h / 2, x1, my + h / 2, h * 0.12, fill="#1D1D22", outline="", tags="dyn")
        cv.create_rectangle(mx + h * 0.1, my - h * 0.36, x1, my - h * 0.22, fill="#34343C", width=0, tags="dyn")
        for yy in (my - h * 0.42, my + h * 0.42):
            cv.create_line(mx + h * 0.22, yy, x1, yy, fill="#8E2B2B", dash=(5, 4), width=2, tags="dyn")
        cv.create_oval(mx - h * 0.2, my - h / 2, mx + h * 0.2, my + h / 2, fill="#0A0A0C", outline="#4A4A54",
                       width=3, tags="dyn")
        if shake_t is not None:
            cv.create_text(mx + h * 0.9, my, text="흔드는 중...", fill="#E9E9EE", font=(UI_FONT, 10, BOLD),
                           tags="dyn")

    def pill(self, x0, y0, x1, y1, fill, text, fg="white", size=12, font=None, tags="dyn"):
        round_rect(self.cv, x0, y0, x1, y1, (y1 - y0) / 2, fill=fill, outline="", tags=tags)
        self.cv.create_text((x0 + x1) / 2, (y0 + y1) / 2, text=text, fill=fg, font=font or (UI_FONT, size, BOLD),
                            tags=tags)

    def redraw_dyn(self):
        cv, geo, g = self.cv, self.geo, self.game
        if not geo or not g or not self.alive:
            return
        cv.delete("dyn")
        W = geo["W"]
        x0, y0, x1, y1 = geo["tray"]
        felt_shadow = blend(FELT, "#000000", 0.45)

        # 위쪽: 누구 차례인지 / 남은 굴리기
        if not self.in_lobby() and not g.over:
            p = g.players[g.current]
            col = PLAYER_COLORS[g.current % len(PLAYER_COLORS)]
            name = p["name"] + (" (나)" if self.role and g.current == self.my_seat else "")
            label = f"{name} 차례" + ("  · 컴퓨터" if p["ai"] else "")
            tw = 62 + tkfont.Font(family=UI_FONT, size=12, weight=BOLD).measure(label)
            self.pill(x0, 12, x0 + tw, 52, blend(BG, "#000000", 0.1), "", tags="dyn")
            self.draw_av(cv, x0 + 22, 32, 30, g.current, ring=col, tags="dyn")
            cv.create_text(x0 + 44, 32, text=label, anchor="w", fill="white", font=(UI_FONT, 12, BOLD),
                           tags="dyn")
            self.pill(x1 - 150, 14, x1, 50, blend(BG, "#000000", 0.1), "", tags="dyn")
            cv.create_text(x1 - 136, 32, text="굴리기", anchor="w", fill="#D9D5EA", font=(UI_FONT, 10, BOLD),
                           tags="dyn")
            for k in range(3):
                cx = x1 - 64 + k * 20
                on = k < g.rolls_left
                cv.create_oval(cx - 7, 25, cx + 7, 39, fill=GOLD if on else "#4A4560", outline="", tags="dyn")

        # 주사위 (고정 칸 -> 굴러가는 것 순서로 그려서 겹침이 자연스럽게)
        s = geo["s"]
        order = sorted(range(5), key=lambda i: (self.dice[i]["rolling"], self.dice[i]["y"]))
        now = time.monotonic()
        for i in order:
            d = self.dice[i]
            if not d["visible"] or (d["rolling"] and now < d.get("spawn", 0)):
                continue
            held = g.held[i] and g.rolled and not d["rolling"]
            lift = 0.0
            if d["rolling"]:
                speed = math.hypot(d.get("vx", 0), d.get("vy", 0))
                lift = min(speed / 1400, 0.35) * s  # 빠를수록 살짝 떠 보이게
            draw_die(cv, d["x"], d["y"] - lift, s * (1 + lift / s * 0.25), d["face"], held=held, angle=d["a"],
                     tags="dyn", shadow=blend("#1F2226", "#000000", 0.4) if held else felt_shadow)

        if self.in_lobby():
            self.draw_lobby()
        elif g.over:
            self.draw_results() if party is not None else self.draw_ranking()

        self.draw_cup(None if self.shake is None else now - self.shake)

        # 큰 버튼 + 안내
        bx0, by0, bx1, by1 = geo["button"]
        text, fill, fg = self.button_state()
        self.pill(bx0, by0, bx1, by1, fill, text, fg=fg, size=14)
        cv.create_text((bx0 + bx1) / 2, geo["hint_y"], text=self.hint_text(), fill="#FFF3E2",
                       font=(UI_FONT, 10, BOLD), tags="dyn", width=max(geo["W"] - 40, 120), justify="center")
        if chat is not None:
            self.draw_chat_fx()

    def button_state(self):
        g = self.game
        disabled = ("#6E4A2E", "#E8D3BF")
        if self.in_lobby():
            if self.role == "host" and self.guests:
                return f"게임 시작 ▶  ({len(self.lobby_names())}명)", GOLD, INK
            if self.role == "host":
                return ("친구를 기다리는 중...",) + disabled
            return ("방장이 시작하길 기다리는 중...",) + disabled
        if g.over:
            return ("다시 하기 ▶", PINK, "white") if self.role != "guest" else ("방장이 새 게임을 시작해요",) + disabled
        if self.anim:
            return ("데구르르...",) + disabled
        if self.can_roll():
            return f"던지기  ({g.rolls_left})", PINK, "white"
        if self.can_act():
            return ("점수표에서 칸을 고르세요",) + disabled
        return (f"{g.players[g.current]['name']} 차례...",) + disabled

    def hint_text(self):
        g = self.game
        if self.spectating:
            return "관전 중이에요 · 채팅과 스티커로 응원해 보세요"
        if self.in_lobby():
            if self.role == "host":
                return f"내 IP {local_ip()} 를 친구에게 알려 주세요"
            return getattr(self, "lobby_text", "")
        if g.over:
            return ""
        if not self.can_act():
            return ""
        if not g.rolled:
            return "오른쪽 컵을 꾹 눌러 흔들다 놓으면 던져요 (오래 흔들수록 세게)"
        if g.rolls_left > 0:
            return "남길 주사위를 클릭하면 위 칸에 고정돼요 · 점수표의 회색 숫자를 눌러 기록"
        return "왼쪽 점수표에서 기록할 칸을 눌러 주세요"

    def draw_lobby(self):
        cv, geo = self.cv, self.geo
        self.avatars = self.lobby_avatars()
        ax0, ay0, ax1, ay1 = geo["area"]
        names = self.lobby_names()
        cv.create_text((ax0 + ax1) / 2, ay0 + 22, text="대기실", fill="#FFE8E8", font=(UI_FONT, 14, BOLD),
                       tags="dyn")
        cols = 3
        cw, ch = (ax1 - ax0 - 40 - 20) / cols, 40
        for i in range(MAX_PLAYERS):
            r, c = divmod(i, cols)
            bx = ax0 + 20 + c * (cw + 10)
            by = ay0 + 52 + r * (ch + 12)
            if i < len(names):
                col = PLAYER_COLORS[i % len(PLAYER_COLORS)]
                self.pill(bx, by, bx + cw, by + ch, "#FFFFFF", "", tags="dyn")
                self.draw_av(cv, bx + ch / 2, by + ch / 2, ch - 8, i, ring=col, tags="dyn")
                font = tkfont.Font(family=UI_FONT, size=11, weight=BOLD)
                label = ("★ " if i == 0 else "") + names[i]
                while font.measure(label) > cw - ch - 14 and len(label) > 2:  # 칸을 넘지 않게 줄임
                    label = label[:-2] + "…"
                cv.create_text(bx + ch + 4, by + ch / 2, text=label, anchor="w", fill=INK, font=font, tags="dyn")
            else:
                round_rect(cv, bx, by, bx + cw, by + ch, ch / 2, fill=blend(FELT, "#000000", 0.25), outline="",
                           tags="dyn")
                cv.create_text(bx + cw / 2, by + ch / 2, text="빈 자리", fill=blend(FELT, "#FFFFFF", 0.45),
                               font=(UI_FONT, 10), tags="dyn")

    def resign(self):
        g = self.game
        if not g or g.over or self.spectating or (self.role and not self.started):
            return
        if self.role:
            seat = self.my_seat
        elif any(p["ai"] for p in g.players):
            seat = 0
        else:
            seat = g.current  # 한 PC 여럿이: 지금 차례인 사람이 항복
        if g.players[seat].get("resigned"):
            return
        if not messagebox.askyesno("항복", f"{g.players[seat]['name']} 항복할까요?"):
            return
        if self.role == "guest":
            send_json(self.conn, {"type": "act", "act": "resign"})
        else:
            self.do_action(seat, "resign")

    # ---- 채팅 / 스티커
    def my_chat_identity(self):
        """(이름, 자리) - 한 PC 여럿이 모드는 '나'."""
        if self.spectating:
            return f"{self.name_var.get().strip() or '관전자'}(관전)", None
        if self.role:
            seat = self.my_seat if self.started else (0 if self.role == "host" else None)
            return self.name_var.get().strip() or "나", seat
        return ("나" if not any(p["ai"] for p in self.game.players) else self.game.players[0]["name"]), 0

    def chat_color(self, seat):
        return PLAYER_COLORS[seat % len(PLAYER_COLORS)] if seat is not None and seat >= 0 else "#3DDC97"

    def fit_bar(self):
        """창이 좁아 위쪽 막대가 넘치면 스티커 줄을 숨김 (채팅 칸의 스티커로 보낼 수 있음)."""
        bar, sb = self.bar, self.sticker_bar
        others = sum(w.winfo_reqwidth() + 16 for w in bar.pack_slaves() if w is not sb)
        need = others + sb.winfo_reqwidth() + 10
        if need > bar.winfo_width():
            if sb.winfo_ismapped():
                sb.pack_forget()
        elif not sb.winfo_ismapped():
            sb.pack(side="left", padx=(10, 0))

    def toggle_chat(self):
        if not self.chat_panel:
            return
        self.chat_open = not self.chat_open
        if self.chat_open:
            need = self.sheet.winfo_width() + 680 + 280 + 60  # 주사위 테이블이 최소 680px는 되게
            if self.root.winfo_width() < need:  # 채팅창 자리만큼 창을 넓힘
                w = min(need, self.root.winfo_screenwidth() - 40)
                self.root.geometry(f"{w}x{self.root.winfo_height()}")
            self.side_col.pack(side="right", fill="y", padx=(14, 0), before=self.cv)
            self.update_people()
            self.unread = 0
            self.chat_toasts.clear()
        else:
            self.side_col.pack_forget()
        self.chat_btn.config(text="채팅 닫기" if self.chat_open else "채팅")

    def on_sticker_bar(self, x):
        k = int(x // 34)
        if 0 <= k < len(chat.STICKERS) and self.chat_panel.ok_to_send():
            self.send_sticker(chat.STICKERS[k][0])

    def send_chat(self, text):
        name, seat = self.my_chat_identity()
        if self.role == "guest":
            send_json(self.conn, {"type": "chat", "text": text})
            return
        self.receive_chat(name, seat, text)
        if self.role == "host":
            for c in self.listeners():
                send_json(c, {"type": "chat", "name": name, "seat": seat, "text": text})
        elif any(p["ai"] for p in self.game.players) and random.random() < 0.6:
            ais = [i for i, p in enumerate(self.game.players) if p["ai"]]
            k = random.choice(ais)
            self.root.after(1200, lambda: self.alive and self.receive_chat(self.game.players[k]["name"], k,
                                                                           random.choice(chat.AI_TEXTS)))

    def send_sticker(self, sid):
        name, seat = self.my_chat_identity()
        if self.role == "guest":
            send_json(self.conn, {"type": "sticker", "id": sid})
            return
        self.receive_sticker(name, sid)
        if self.role == "host":
            for c in self.listeners():
                send_json(c, {"type": "sticker", "name": name, "id": sid})
        elif any(p["ai"] for p in self.game.players) and random.random() < 0.5:
            ais = [i for i, p in enumerate(self.game.players) if p["ai"]]
            k = random.choice(ais)
            self.root.after(1400, lambda: self.alive and self.receive_sticker(self.game.players[k]["name"],
                                                                              random.choice(chat.STICKERS)[0]))

    def receive_chat(self, name, seat, text):
        if not self.chat_panel:
            return
        text = str(text)[:chat.MAX_TEXT]
        self.chat_panel.add(name, text, self.chat_color(seat))
        if not self.chat_open:  # 채팅창이 닫혀 있으면 테이블 아래에 잠깐 표시 + 안 읽은 수
            self.unread += 1
            self.chat_btn.config(text=f"채팅 ({self.unread})")
            self.chat_toasts.append((name, text, time.monotonic()))
            del self.chat_toasts[:-3]
            self.ensure_loop()

    def receive_sticker(self, name, sid):
        if chat and sid in chat.STICKER_IDS:
            k = sum(1 for p in self.popups if chat.popup_frame(time.monotonic() - p["t0"]))
            self.popups.append(chat.new_popup(sid, name, k % 3))
            self.ensure_loop()

    def chat_fx_active(self):
        if chat is None:
            return False
        now = time.monotonic()
        return any(now - p["t0"] < chat.POPUP_TIME for p in self.popups) or \
            any(now - t < 5 for _, _, t in self.chat_toasts)

    def draw_chat_fx(self):
        cv, geo = self.cv, self.geo
        fx0, fy0, fx1, fy1 = geo["felt"]
        W, H = geo["W"], geo["H"]
        chat.draw_popups(cv, self.popups, lambda p: (W - 56 - (p["who"] or 0) * 78, H - 70), 64,
                         (UI_FONT, 9, BOLD), tags="dyn")
        now = time.monotonic()
        y = geo["H"] - 16
        for name, text, t in reversed(self.chat_toasts):
            if now - t >= 5:
                continue
            tid = cv.create_text(18, y, text=f"{name}: {text}", anchor="sw", fill="white", font=(UI_FONT, 10, BOLD),
                                 tags="dyn")
            x0, y0, x1, y1 = cv.bbox(tid)
            rect = round_rect(cv, x0 - 10, y0 - 5, x1 + 10, y1 + 5, 12, fill="#2B2440", outline="", tags="dyn")
            cv.tag_raise(tid, rect)
            y = y0 - 14

    # ---- 게임 결과: 시상대, 멘트, 티배깅
    def viewer_seat(self):
        """이 화면의 주인 자리 (한 PC 여럿이 모드에서는 1등이 대표)."""
        g = self.game
        if self.role:
            return -1 if self.spectating else self.my_seat
        if any(p["ai"] for p in g.players):
            return 0
        return g.ranking()[0]

    def seat_kind(self, seat):
        g = self.game
        top = g.total(g.players[g.ranking()[0]])
        return "win" if g.total(g.players[seat]) == top else "lose"

    def on_game_over(self):
        g = self.game
        self.fx_bubbles, self.teabag = {}, None
        self.emote_opts = [] if self.spectating else party.pick_lines(self.seat_kind(self.viewer_seat()))
        r = g.ranking()
        comments = []
        if len(r) > 1:
            gap = g.total(g.players[r[0]]) - g.total(g.players[r[1]])
            if gap == 0:
                comments.append("공동 1등!")
            elif gap <= 5:
                comments.append(f"단 {gap}점 차 대접전!")
            elif gap >= 60:
                comments.append("압도적인 승리!")
        for p in g.players:
            if p["scores"].get("yacht") == 50:
                comments.append(f"{p['name']} 야추 성공!")
                break
        quit_ = [p["name"] for p in g.players if p.get("resigned")]
        if quit_:
            comments.insert(0, f"{quit_[0]} 항복!")
        bonus = [p["name"] for p in g.players if g.bonus(p)]
        if bonus and len(comments) < 2:
            comments.append(f"{bonus[0]} 보너스 +{BONUS}")
        if not comments:
            comments.append(f"{g.players[r[0]]['name']} 우승!")
        self.result_comment = comments[:2]
        self.tally_text = ""
        me = self.viewer_seat()
        sfx("win" if me is not None and me >= 0 and me == r[0] else "lose" if me is not None and me >= 0 else "win")
        if len(r) > 1 and self.chat_panel:  # 꼴찌에게 질문 카드 (모두 같은 질문이 나오게)
            last = g.players[r[-1]]["name"]
            q = party.question_for(*[p["name"] for p in g.players], g.total(g.players[r[0]]))
            self.chat_panel.add("", f"💬 질문 카드  {last}님: {q}", system=True)
            self.result_comment = (comments[:1] + [f"💬 {last}님: {q}"])
        record = self.on_result and not self.spectating and (self.role or any(p["ai"] for p in g.players))
        if record:
            names = [p["name"] for p in g.players]
            top = g.total(g.players[r[0]])
            tally = self.on_result("yacht", names, [p["name"] for p in g.players if g.total(p) == top])
            self.tally_text = "누적 우승   " + "  ·  ".join(f"{n} {tally.get(n, 0)}회" for n in names)
        self.ensure_loop()

    def fx_active(self):
        now = time.monotonic()
        if self.teabag and now - self.teabag["t0"] >= party.TEABAG_TIME:
            self.teabag = None
        return bool(self.teabag) or any(exp > now for _, exp in self.fx_bubbles.values())

    def send_emote(self, text=None, teabag=False):
        g = self.game
        now = time.monotonic()
        if not g or not g.over or party is None or now - self.last_emote < 0.6 or self.spectating:
            return
        seat = self.viewer_seat()
        if teabag and seat != g.ranking()[0]:
            return  # 1등만 티배깅
        self.last_emote = now
        if self.role == "guest":
            send_json(self.conn, {"type": "emote", "seat": seat, "text": text, "teabag": teabag})
            return
        self.apply_emote(seat, text, teabag)
        if self.role == "host":
            for c in self.listeners():
                send_json(c, {"type": "emote", "seat": seat, "text": text, "teabag": teabag})
        ais = [i for i, p in enumerate(g.players) if p["ai"] and i != seat]
        if ais and not self.role:  # 컴퓨터가 받아침
            k = random.choice(ais)
            self.root.after(1300, lambda: self.alive and g is self.game and
                            self.apply_emote(k, party.reply_line(self.seat_kind(k))))

    def apply_emote(self, seat, text=None, teabag=False):
        g = self.game
        if not g or not g.over or not 0 <= seat < len(g.players):
            return
        now = time.monotonic()
        if teabag:
            r = g.ranking()
            target = r[-1]
            if seat == r[0] and target != seat:
                self.teabag = {"actor": seat, "target": target, "t0": now}
                party.teabag_sounds(self.root)
                self.fx_bubbles[seat] = ("티배깅!", now + 1.2)
        elif text:
            self.fx_bubbles[seat] = (str(text)[:24], now + 3.5)
        self.ensure_loop()

    def draw_results(self):
        cv, geo, g = self.cv, self.geo, self.game
        fx0, fy0, fx1, fy1 = geo["felt"]
        if fy1 - fy0 < 330 or fx1 - fx0 < 440:  # 펠트가 작으면 테이블 전체를 덮는 결과 카드로
            fx0, fy0, fx1, fy1 = 14, 14, geo["W"] - 14, geo["button"][1] - 10  # '다시 하기' 버튼 위까지
            round_rect(cv, fx0 + 5, fy0 + 8, fx1 + 5, fy1 + 8, 22, fill=blend(WOOD, "#000000", 0.5), outline="",
                       tags="dyn")
            round_rect(cv, fx0, fy0, fx1, fy1, 22, fill=blend(FELT, "#000000", 0.35), outline="#E8B04B", width=2,
                       tags="dyn")
        else:
            round_rect(cv, fx0 + 4, fy0 + 4, fx1 - 4, fy1 - 4, 14, fill=blend(FELT, "#000000", 0.42), outline="",
                       tags="dyn")
        W, H = fx1 - fx0, fy1 - fy0
        cx = (fx0 + fx1) / 2
        k = max(min(1.0, H / 380, W / 520), 0.6)  # 작은 창이면 글자/간격도 작게

        def F(size, family=UI_FONT):
            return (family, -max(int(size * k * 1.33), 9), BOLD)

        party.confetti(cv, (fx0 + 10, fy0 + 8, fx1 - 10, fy1 - 8), tags="dyn", seed=5)
        cv.create_text(cx, fy0 + 24 * k, text="게임 결과", fill=GOLD, font=F(17), tags="dyn")
        if self.result_comment:
            cv.create_text(cx, fy0 + 50 * k, text="   ·   ".join(self.result_comment), fill="#FFE3E3",
                           font=F(11), tags="dyn", width=W - 30, justify="center")
        r = g.ranking()
        base = fy0 + H * 0.66
        sw = min(122, W / 4.4)
        places = [(0, cx, H * 0.22, min(66, H * 0.17), GOLD), (1, cx - sw * 1.14, H * 0.16, min(54, H * 0.14), "#D9DDE3"),
                  (2, cx + sw * 1.14, H * 0.11, min(50, H * 0.13), "#E0A36B")]
        self.podium = {}
        now = time.monotonic()
        tb = self.teabag
        for place, x, sh, size, col in places:
            if place >= len(r):
                continue
            seat = r[place]
            p = g.players[seat]
            if place == 0:
                party.spotlight(cv, x, base - sh - size / 2, size * 1.3, tags="dyn")
            round_rect(cv, x - sw / 2, base - sh, x + sw / 2, base, 10, fill=col, outline="", tags="dyn")
            cv.create_text(x, base - sh / 2, text=str(place + 1), fill=blend(col, "#000000", 0.45),
                           font=F(22, NUM_FONT), tags="dyn")
            cv.create_text(x, base + 16 * k, text=p["name"], fill="white", font=F(11), tags="dyn", width=sw + 10)
            cv.create_text(x, base + 36 * k, text=f"{g.total(p)}점", fill=GOLD if place == 0 else "#F1E6E6",
                           font=F(13, NUM_FONT), tags="dyn")
            self.podium[seat] = (x, base - sh - size / 2 - 6, size)
        if len(r) > 3:
            rest = "     ".join(f"{k + 1}위 {g.players[i]['name']} {g.total(g.players[i])}점" for k, i in enumerate(r)
                               if k >= 3)
            cv.create_text(cx, base + 58 * k, text=rest, fill="#F1E6E6", font=F(10), tags="dyn", width=W - 30,
                           justify="center")
        if self.tally_text:
            cv.create_text(cx, fy1 - 56 * k, text=self.tally_text, fill="#FFD9D9", font=F(9), tags="dyn",
                           width=W - 30, justify="center")

        # 프로필 (티배깅 중인 사람은 마지막에 따로)
        for seat, (x, y, size) in self.podium.items():
            if tb and tb["actor"] == seat:
                continue
            if tb and tb["target"] == seat:  # 당하는 사람은 눌릴 때마다 흔들림
                dx, dy = party.teabag_shake(now - tb["t0"], size)
                x, y = x + dx, y + dy
            self.draw_av(cv, x, y, size, seat, ring="white", tags="dyn")
            if seat == r[0]:
                party.draw_crown(cv, x, y - size / 2 + 2, size * 0.55, tags="dyn")
        bubble_at = dict(self.podium)
        if tb and tb["actor"] in self.podium and tb["target"] in self.podium:
            x, y, size = self.podium[tb["actor"]]
            tx, ty, tsize = self.podium[tb["target"]]
            pos = party.teabag_pos(now - tb["t0"], (x, y), (tx, ty), tsize)
            if pos:
                party.draw_teabag_fx(cv, now - tb["t0"], (tx, ty, tsize), (UI_FONT, BOLD), tags="dyn")
                self.draw_av(cv, pos[0], pos[1], size, tb["actor"], ring="white", tags="dyn")
                bubble_at[tb["actor"]] = (pos[0], pos[1], size)
                party.draw_teabag_fx(cv, now - tb["t0"], (tx, ty, tsize), (UI_FONT, BOLD), tags="dyn", layer="over")
        for seat, (text, exp) in self.fx_bubbles.items():
            if exp > now and seat in bubble_at:
                x, y, size = bubble_at[seat]
                party.draw_bubble(cv, x, y - size / 2 - 2, text, F(10), tags="dyn")

        # 멘트 버튼 + 티배깅
        font = tkfont.Font(family=UI_FONT, size=-max(int(10 * k * 1.33), 9), weight=BOLD)
        winner_view = not self.spectating and self.viewer_seat() == r[0]
        labels = [(f"emote{k}", t) for k, t in enumerate(self.emote_opts)] + \
            ([("teabag", "티배깅!")] if winner_view else [])
        widths = [font.measure(t) + 26 for _, t in labels]
        while len(labels) > 2 and sum(widths) + 8 * (len(widths) - 1) > W - 24:  # 폭이 모자라면 멘트를 줄임
            del labels[-2 if winner_view else -1], widths[-2 if winner_view else -1]
        x = cx - (sum(widths) + 8 * (len(widths) - 1)) / 2
        y0, y1 = fy1 - 40 * k, fy1 - 12 * k
        self.emote_hits = []
        for (tag, text), w in zip(labels, widths):
            if tag == "teabag":
                action = lambda: self.send_emote(teabag=True)
            else:
                action = lambda t=text: self.send_emote(text=t)
            self.emote_hits.append((x, y0, x + w, y1, action))
            fill = GOLD if tag == "teabag" else "#FFFFFF"
            round_rect(cv, x, y0, x + w, y1, 14, fill=fill, outline="", tags=("dyn", tag))
            cv.create_text(x + w / 2, (y0 + y1) / 2, text=text, fill=INK, font=font, tags=("dyn", tag))
            x += w + 8

    def draw_ranking(self):
        cv, geo, g = self.cv, self.geo, self.game
        ax0, ay0, ax1, ay1 = geo["area"]
        cx = (ax0 + ax1) / 2
        rows = g.ranking()
        h = 34
        top = (ay0 + ay1) / 2 - (len(rows) * (h + 6)) / 2
        medal = {0: GOLD, 1: "#D9DDE3", 2: "#E0A36B"}
        for rank, i in enumerate(rows):
            p = g.players[i]
            y = top + rank * (h + 6)
            self.pill(cx - 190, y, cx + 190, y + h, "#FFFFFF" if rank else "#FFF4CC", "", tags="dyn")
            cv.create_oval(cx - 178, y + 5, cx - 154, y + h - 5, fill=medal.get(rank, "#C9C2B0"), outline="",
                           tags="dyn")
            cv.create_text(cx - 166, y + h / 2, text=str(rank + 1), fill=INK, font=(NUM_FONT, 11, BOLD), tags="dyn")
            self.draw_av(cv, cx - 126, y + h / 2, h - 8, i, tags="dyn")
            cv.create_text(cx - 106, y + h / 2, text=p["name"], anchor="w", fill=INK, font=(UI_FONT, 11, BOLD),
                           tags="dyn")
            cv.create_text(cx + 176, y + h / 2, text=f"{g.total(p)}", anchor="e", fill=INK,
                           font=(NUM_FONT, 14, BOLD), tags="dyn")

    # ---- 점수표 (종이 느낌, 캔버스에 직접 그림: 옆으로 스크롤 + 차례인 사람 자동 포커스 + 말풍선)
    SHEET_CAT_W, SHEET_COL_W, SHEET_HEAD_H, SHEET_VISIBLE = 150, 94, 80, 4
    SHEET_ROWS = UPPER + ["_sub", "_bonus"] + LOWER + ["_total"]

    def sheet_geometry(self):
        n = len(self.game.players)
        view_w = self.SHEET_COL_W * min(n, self.SHEET_VISIBLE)
        max_scroll = max(0, n * self.SHEET_COL_W - view_w)
        h = max(self.sheet.winfo_height(), 300)
        row_h = max((h - self.SHEET_HEAD_H) / len(self.SHEET_ROWS), 26)
        return view_w, max_scroll, row_h

    def update_table(self):
        g = self.game
        view_w, max_scroll, _ = self.sheet_geometry()
        width = self.SHEET_CAT_W + view_w
        if int(self.sheet.cget("width")) != width:
            self.sheet.config(width=width)
        if g.current != self.sheet_focus or len(g.players) != self.sheet_players:
            # 차례가 바뀌면 그 사람 열을 맨 앞으로
            self.sheet_focus, self.sheet_players = g.current, len(g.players)
            self.sheet_tx = min(max(g.current * self.SHEET_COL_W, 0), max_scroll)
            self.sheet_x = min(self.sheet_x, max_scroll)
            self.ensure_loop()
        self.draw_sheet()

    def sheet_step(self, dt):
        """스크롤 위치를 목표로 부드럽게 이동. 아직 움직이면 True."""
        if abs(self.sheet_x - self.sheet_tx) < 0.5:
            if self.sheet_x != self.sheet_tx:
                self.sheet_x = self.sheet_tx
                self.draw_sheet()
            return False
        self.sheet_x += (self.sheet_tx - self.sheet_x) * (1 - math.exp(-dt * 10))
        self.draw_sheet()
        return True

    def draw_sheet(self):
        cv, g = self.sheet, self.game
        if not g or not self.alive:
            return
        cv.delete("all")
        W = int(cv.cget("width"))
        H = max(cv.winfo_height(), 300)
        cat_w, col_w, head_h = self.SHEET_CAT_W, self.SHEET_COL_W, self.SHEET_HEAD_H
        view_w, max_scroll, row_h = self.sheet_geometry()
        can = self.can_act() and g.rolled
        hover = self.sheet_hover
        name_font = tkfont.Font(family=UI_FONT, size=10, weight=BOLD)

        for j, p in enumerate(g.players):
            x = cat_w + j * col_w - self.sheet_x
            if x + col_w < cat_w or x > W:
                continue
            cur = j == g.current and not g.over
            col_bg = HILITE if cur else CELL
            pc = PLAYER_COLORS[j % len(PLAYER_COLORS)]
            cv.create_rectangle(x, 0, x + col_w, head_h, fill=col_bg, width=0)
            self.draw_av(cv, x + col_w / 2, 28, 38, j, ring=pc if cur else None)
            if self.role and j == self.my_seat:
                ui_kit.round_rect(cv, x + col_w - 30, 6, x + col_w - 6, 22, 8, ACCENT)  # 매끈한 알약 배지
                cv.create_text(x + col_w - 18, 14, text="나", fill="white", font=(UI_FONT, 8, BOLD))
            name = p["name"] + (" · 항복" if p.get("resigned") else (" · 나감" if p["left"] else ""))
            while name_font.measure(name) > col_w - 10 and len(name) > 2:
                name = name[:-2] + "…"
            cv.create_text(x + col_w / 2, 62, text=name, fill=blend(pc, "#000000", 0.25), font=name_font)
            for r, cat in enumerate(self.SHEET_ROWS):
                y = head_h + r * row_h
                if cat.startswith("_"):
                    cv.create_rectangle(x, y, x + col_w, y + row_h, fill=BAND, width=0)
                    up = g.upper_sum(p)
                    if cat == "_sub":
                        text, fg, font = f"{up}/{BONUS_NEED}", GOLD if up >= BONUS_NEED else "#CFC6B2", (NUM_FONT, 10, BOLD)
                    elif cat == "_bonus":
                        bonus = g.bonus(p)
                        done = all(c in p["scores"] for c in UPPER)
                        text, fg, font = f"+{bonus}" if bonus else ("0" if done else ""), GOLD if bonus else "#9A917F", \
                            (NUM_FONT, 10, BOLD)
                    else:
                        win = g.over and j == g.ranking()[0]
                        text, fg, font = str(g.total(p)), GOLD if win else "white", (NUM_FONT, 17, BOLD)
                    cv.create_text(x + col_w / 2, y + row_h / 2, text=text, fill=fg, font=font)
                    continue
                clickable = can and cur and cat not in p["scores"]
                bg = "#FFC93D" if clickable and hover == (j, cat) else col_bg
                cv.create_rectangle(x, y, x + col_w, y + row_h, fill=bg, width=0)
                if cat in p["scores"]:
                    cv.create_text(x + col_w / 2, y + row_h / 2, text=str(p["scores"][cat]), fill=INK,
                                   font=(NUM_FONT, 15, BOLD))
                elif cur and g.rolled and not self.anim:
                    v = score(cat, g.dice)
                    cv.create_text(x + col_w / 2, y + row_h / 2, text=str(v), fill=INK_SOFT if v == 0 else "#8C7A52",
                                   font=(NUM_FONT, 15, BOLD))
            cv.create_line(x, 0, x, H, fill=PAPER)

        # 왼쪽 항목 이름 칸 (스크롤해도 고정)
        cv.create_rectangle(0, 0, cat_w, H, fill=CELL, width=0)
        cv.create_rectangle(0, 0, cat_w, head_h, fill=BAND, width=0)
        cv.create_text(cat_w / 2, head_h / 2 - 8, text="게임 종료" if g.over else f"Turn {g.round}/12", fill="white",
                       font=(NUM_FONT, 16, BOLD))
        cv.create_text(cat_w / 2, head_h / 2 + 18, text="이름에 마우스를 올려 보세요", fill="#BDB3A0",
                       font=(UI_FONT, 8))
        for r, cat in enumerate(self.SHEET_ROWS):
            y = head_h + r * row_h
            band = cat.startswith("_")
            hovered = hover is not None and hover[1] == cat
            fill = BAND if band else ("#F3EAD5" if hovered else CELL)
            cv.create_rectangle(0, y, cat_w, y + row_h, fill=fill, width=0)
            label = {"_sub": "소계", "_bonus": f"+{BONUS} 보너스", "_total": "총점"}.get(cat) or CAT_NAMES[cat]
            if cat in UPPER:
                draw_die(cv, 22, y + row_h / 2 - 1, min(row_h * 0.6, 20), UPPER.index(cat) + 1, shadow=fill)
            cv.create_text(42 if not band else 14, y + row_h / 2, text=label, anchor="w",
                           fill="#EDE6D6" if band else INK, font=(UI_FONT, 11 if cat == "_total" else 10, BOLD))
        for r in range(len(self.SHEET_ROWS) + 1):
            y = head_h + r * row_h
            cv.create_line(0, y, W, y, fill=PAPER)
        cv.create_line(cat_w, 0, cat_w, H, fill=PAPER, width=2)

        # 스크롤 표시
        if max_scroll > 0:
            for side, show in ((-1, self.sheet_x > 1), (1, self.sheet_x < max_scroll - 1)):
                if not show:
                    continue
                ax = cat_w + 14 if side < 0 else W - 14
                cv.create_oval(ax - 11, head_h / 2 - 11, ax + 11, head_h / 2 + 11, fill=INK, outline="")
                cv.create_text(ax, head_h / 2, text="◀" if side < 0 else "▶", fill="white", font=(UI_FONT, 8))
        ui_kit.round_corners(cv, 18)

    def sheet_hit(self, x, y):
        """마우스 위치 -> (열 번호 또는 'cat', 항목) / 해당 없음이면 None."""
        g = self.game
        if not g:
            return None
        _, _, row_h = self.sheet_geometry()
        r = int((y - self.SHEET_HEAD_H) // row_h)
        if y < self.SHEET_HEAD_H or not 0 <= r < len(self.SHEET_ROWS):
            return None
        cat = self.SHEET_ROWS[r]
        if x < self.SHEET_CAT_W:
            return "cat", cat
        j = int((x - self.SHEET_CAT_W + self.sheet_x) // self.SHEET_COL_W)
        return (j, cat) if 0 <= j < len(g.players) else None

    def on_sheet_motion(self, e):
        hit = self.sheet_hit(e.x, e.y)
        if hit != self.sheet_hover:
            self.sheet_hover = hit
            self.draw_sheet()
            self.hide_tip()
            if hit:
                self.tip_job = self.root.after(250, lambda: self.show_tip(hit[1], e.x_root, e.y_root))
        clickable = (hit and hit[0] != "cat" and self.can_act() and self.game.rolled and hit[0] == self.game.current
                     and hit[1] in CATEGORIES and hit[1] not in self.game.players[hit[0]]["scores"])
        self.sheet.config(cursor="hand2" if clickable else "")

    def on_sheet_leave(self, _e):
        self.sheet_hover = None
        self.hide_tip()
        self.draw_sheet()

    def on_sheet_click(self, e):
        hit = self.sheet_hit(e.x, e.y)
        if hit and hit[0] != "cat" and hit[1] in CATEGORIES:
            self.hide_tip()
            self.on_cell(hit[0], hit[1])

    def on_sheet_wheel(self, e):
        _, max_scroll, _ = self.sheet_geometry()
        if max_scroll <= 0:
            return
        step = -self.SHEET_COL_W if (getattr(e, "delta", 0) > 0 or getattr(e, "num", 0) == 4) else self.SHEET_COL_W
        self.sheet_tx = min(max(self.sheet_tx + step, 0), max_scroll)
        self.ensure_loop()

    # ---- 족보 말풍선
    EXAMPLES = {"ones": [1, 1, 1, 4, 6], "twos": [2, 2, 5, 6, 1], "threes": [3, 3, 3, 2, 6], "fours": [4, 4, 1, 2, 5],
                "fives": [5, 5, 5, 5, 2], "sixes": [6, 6, 6, 3, 1], "choice": [6, 5, 5, 3, 2], "four": [4, 4, 4, 4, 2],
                "full": [3, 3, 3, 5, 5], "sstraight": [1, 2, 3, 4, 6], "lstraight": [2, 3, 4, 5, 6],
                "yacht": [6, 6, 6, 6, 6]}

    def show_tip(self, cat, x_root, y_root):
        self.hide_tip()
        if not self.alive or self.sheet_hover is None or self.sheet_hover[1] != cat:
            return
        g = self.game
        tip = tk.Toplevel(self.root)
        tip.overrideredirect(True)
        tip.attributes("-topmost", True)
        key = INK
        if sys.platform == "win32":  # 창 모서리를 투명하게 해서 둥근 풍선처럼
            key = "#010203"
            tip.config(bg=key)
            tip.attributes("-transparentcolor", key)
        c = tk.Canvas(tip, width=280, height=200, bg=key, highlightthickness=0)
        c.pack()
        if cat.startswith("_"):
            title = {"_sub": "소계", "_bonus": "보너스", "_total": "총점"}[cat]
            body = {"_sub": f"에이스~식스 점수의 합이에요.\n{BONUS_NEED}점 이상이면 보너스 +{BONUS}점!",
                    "_bonus": f"소계가 {BONUS_NEED}점 이상이면 +{BONUS}점을 받아요.\n(각 숫자를 3개씩 모으면 딱 {BONUS_NEED}점)",
                    "_total": "모든 칸 점수 + 보너스.\n12칸을 다 채우면 총점이 가장 높은 사람이 이겨요."}[cat]
            c.create_text(16, 16, text=title, anchor="nw", fill=GOLD, font=(UI_FONT, 14, BOLD))
            c.create_text(16, 48, text=body, anchor="nw", fill="#F4EEDF", font=(UI_FONT, 10), width=250)
        else:
            c.create_text(16, 16, text=CAT_NAMES[cat], anchor="nw", fill=GOLD, font=(UI_FONT, 14, BOLD))
            c.create_text(16, 46, text=CAT_HELP[cat], anchor="nw", fill="#F4EEDF", font=(UI_FONT, 10), width=250)
            ex = self.EXAMPLES[cat]
            y = 104
            c.create_text(16, y - 18, text="예시", anchor="nw", fill="#BDB3A0", font=(UI_FONT, 9))
            for k, v in enumerate(ex):
                draw_die(c, 30 + k * 34, y + 14, 26, v, shadow=blend(INK, "#000000", 0.4))
            c.create_text(268, y + 14, text=f"→ {score(cat, ex)}점", anchor="e", fill="white",
                          font=(NUM_FONT, 13, BOLD))
            if g and g.rolled and not g.over and cat not in g.players[g.current]["scores"]:
                c.create_text(16, y + 46, text=f"지금 주사위로 기록하면  {score(cat, g.dice)}점", anchor="nw",
                              fill=GOLD, font=(UI_FONT, 10, BOLD))
        x0, y0, x1, y1 = c.bbox("all")
        c.config(width=max(x1 + 16, 220), height=y1 + 16)
        bg_id = round_rect(c, 0, 0, max(x1 + 16, 220), y1 + 16, 16, fill=INK, outline="")
        c.tag_lower(bg_id)
        tip.update_idletasks()
        sw = tip.winfo_screenwidth()
        x = min(x_root + 18, sw - c.winfo_reqwidth() - 8)
        tip.geometry(f"+{int(x)}+{int(y_root + 14)}")
        self.tip = tip

    def hide_tip(self):
        if getattr(self, "tip_job", None):
            self.root.after_cancel(self.tip_job)
            self.tip_job = None
        if getattr(self, "tip", None) is not None:
            try:
                self.tip.destroy()
            except tk.TclError:
                pass
            self.tip = None

    # ---- 프로필 그림
    def draw_av(self, cv, x, y, size, seat, ring=None, tags=()):
        spec = self.avatars[seat] if 0 <= seat < len(self.avatars) else None
        if avatars is not None:
            avatars.draw_avatar(cv, x, y, size, spec or avatars.default_avatar(seat), tags=tags, ring=ring)
        else:
            col = PLAYER_COLORS[seat % len(PLAYER_COLORS)]
            cv.create_oval(x - size / 2, y - size / 2, x + size / 2, y + size / 2, fill=col, outline=ring or "",
                           width=3 if ring else 0, tags=tags)

    # ---- 대기실 / 알림
    def in_lobby(self):
        return self.role in ("host", "guest") and not self.started

    def lobby_avatars(self):
        if self.role == "host":
            return [self.my_avatar] + [x.get("avatar") for x in self.guests]
        return getattr(self, "lobby_avatar_list", [])

    def lobby_names(self):
        if self.role == "host":
            return [self.name_var.get().strip() or "방장"] + [x["name"] for x in self.guests]
        return getattr(self, "lobby_list", [])

    def toast(self, text):
        """화면 위쪽에 잠깐 떴다 사라지는 알림."""
        card = ui_kit.Card(self.root, fill=GOLD, radius=20, pad=8)
        tk.Label(card.body, text=text, bg=GOLD, fg=INK, font=(UI_FONT, 11, BOLD), padx=10).pack()
        card.place(relx=0.5, y=14, anchor="n")
        tk.Misc.lift(card)  # (캔버스의 lift는 그림 올리기라서 위젯용으로)
        self.root.after(2600, lambda: card.winfo_exists() and card.destroy())

    # ---- 네트워크 (같은 와이파이)
    def open_net_dialog(self):
        win = tk.Toplevel(self.root, bg=PANEL)
        win.title("네트워크 대전")
        win.resizable(False, False)
        win.transient(self.root)
        font = (UI_FONT, 10)
        tk.Label(win, text=f"내 IP: {local_ip()}   (포트 {PORT})", font=(UI_FONT, 12, BOLD), bg=PANEL,
                 fg=TEXT).pack(padx=18, pady=(16, 2))
        tk.Label(win, text=f"방을 만들면 최대 {MAX_PLAYERS}명까지 참가할 수 있습니다", font=font, bg=PANEL,
                 fg=MUTED).pack(padx=18)
        make_button(win, "방 만들기", lambda: (win.destroy(), self.host()), ACCENT).pack(
            fill="x", padx=18, pady=(10, 16))
        tk.Label(win, text="방장 PC의 IP로 참가", font=font, bg=PANEL, fg=TEXT).pack()
        entry = tk.Entry(win, width=22, justify="center", font=(MONO_FONT, 12), relief="flat")
        entry.pack(padx=18, pady=6, ipady=4)
        entry.focus_set()

        def join():
            ip = entry.get().strip()  # 창을 닫기 전에 읽어야 함
            win.destroy()
            self.join(ip)

        entry.bind("<Return>", lambda e: join())
        make_button(win, "참가하기", join, CARD).pack(fill="x", padx=18, pady=(2, 18))

    def host(self):
        self.close_net()
        try:
            srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            srv.bind(("", PORT))
            srv.listen(MAX_PLAYERS)
        except OSError as e:
            messagebox.showerror("네트워크", f"방을 만들 수 없습니다: {e}")
            return
        self.server = srv
        self.role = "host"
        self.started = False
        threading.Thread(target=self._accept_loop, args=(srv,), daemon=True).start()
        self.update_labels()

    def _accept_loop(self, srv):
        while True:
            try:
                conn, _ = srv.accept()
            except OSError:
                return  # 방을 닫음
            self.net_queue.put(("conn", conn, None))

    def join(self, ip, spectate=False):
        if not ip:
            return
        self.close_net()
        self.spectating = spectate
        if spectate:
            self.my_seat = -1
        self.lobby_list = []
        self.role = "guest"
        self.started = False
        self.join_ip, self.reconnect_until = ip, 0
        self.lobby_text = f"{ip} 에 접속하는 중..."
        self.update_labels()
        threading.Thread(target=self._connect, args=(ip,), daemon=True).start()

    def _connect(self, ip):
        try:
            conn = socket.create_connection((ip, PORT), timeout=5)
            conn.settimeout(None)
        except OSError as e:
            self.net_queue.put(("error", None, f"접속 실패: {e}"))
            return
        self.net_queue.put(("connected", conn, None))

    def _reader(self, conn):
        try:
            f = conn.makefile("r", encoding="utf-8")
            while True:
                line = f.readline(MAX_LINE + 1)  # 비정상적으로 큰 메시지는 다 읽지 않고 연결을 끊음
                if not line or len(line) > MAX_LINE:
                    break
                self.net_queue.put(("msg", conn, json.loads(line)))
        except (OSError, ValueError):
            pass
        self.net_queue.put(("closed", conn, None))

    def broadcast_state(self):
        state = self.game.to_dict()
        n = len(self.specs)
        names = [x["name"] for x in self.specs][:20]
        for g in self.guests:
            send_json(g["conn"], {"type": "state", "state": state, "seat": g["seat"], "specs": n,
                                  "spec_names": names})
        for x in self.specs:
            send_json(x["conn"], {"type": "state", "state": state, "seat": -1, "specs": n, "spec_names": names})

    def spec_changed(self, note):
        if self.chat_panel:
            self.chat_panel.add("", note, system=True)
        self.toast(note)
        for c in self.listeners():
            send_json(c, {"type": "specs", "n": len(self.specs), "names": [x["name"] for x in self.specs][:20]})
        self.update_status()

    def broadcast_lobby(self):
        names = [self.name_var.get().strip() or "방장"] + [g["name"] for g in self.guests]
        avs = self.lobby_avatars()
        for c in self.listeners():
            send_json(c, {"type": "lobby", "names": names, "avatars": avs})
        self.update_labels()

    def start_net_game(self):
        if not self.guests:
            messagebox.showinfo("야추", "참가자가 1명 이상 들어와야 시작할 수 있어요.")
            return
        names = [self.name_var.get().strip() or "방장"]
        for seat, g in enumerate(self.guests, 1):
            g["seat"] = seat
            names.append(g["name"])
        self.started = True
        self.avatars = self.lobby_avatars()
        for c in self.listeners():
            send_json(c, {"type": "avatars", "list": self.avatars})
        self.start_game(YachtGame(names), seat=0)

    def poll_net(self):
        if not self.alive:
            return
        while not self.net_queue.empty():
            kind, conn, data = self.net_queue.get()
            if kind == "error":
                if getattr(self, "reconnect_until", 0):  # 다시 접속 중: 조용히 다음 시도
                    self.root.after(2000, self.try_reconnect)
                    continue
                self.role = None
                self.lobby_text = data
                messagebox.showerror("네트워크", data)
                self.update_labels()
            elif kind == "conn":  # 방장: 새 참가자
                if self.role != "host":
                    conn.close()
                    continue
                threading.Thread(target=self._reader, args=(conn,), daemon=True).start()
            elif kind == "connected":  # 참가자: 방장에 연결됨
                self.conn = conn
                if getattr(self, "reconnect_until", 0):
                    self.reconnect_until = 0
                    self.toast("다시 연결됐어요! 이어서 해요")
                threading.Thread(target=self._reader, args=(conn,), daemon=True).start()
                send_json(conn, {"type": "hello", "name": self.name_var.get().strip() or "참가자",
                                 "avatar": self.my_avatar, "spectate": self.spectating})
                self.lobby_text = "대기실에 들어왔습니다. 방장이 시작하길 기다리는 중..."
                self.update_labels()
            elif kind == "closed":
                self.on_disconnect(conn)
            elif self.role == "host":
                self.on_host_msg(conn, data)
            elif self.role == "guest" and conn is self.conn:
                self.on_guest_msg(data)
        self.root.after(100, self.poll_net)

    def listeners(self):
        return [g["conn"] for g in self.guests] + [x["conn"] for x in self.specs]

    def on_host_msg(self, conn, data):
        guest = next((g for g in self.guests if g["conn"] is conn), None)
        spec = next((x for x in self.specs if x["conn"] is conn), None)
        if data.get("type") == "hello" and guest is None and spec is None and self.started and self.game and \
                not self.game.over and not data.get("spectate"):
            name = str(data.get("name", ""))[:12]
            seat = next((i for i, p in enumerate(self.game.players) if p.get("left") and
                         (p["name"] == name or p["name"].startswith(name))), None)
            if seat is not None:  # 끊겼던 사람이 돌아옴: 컴퓨터가 대신 두던 자리를 돌려줌
                p = self.game.players[seat]
                p["left"], p["ai"] = False, False
                av = avatars.valid(data.get("avatar")) if avatars else None
                self.guests.append({"conn": conn, "name": p["name"], "seat": seat, "avatar": av})
                send_json(conn, {"type": "avatars", "list": self.avatars})
                self.toast(f"{p['name']}님이 다시 들어왔어요!")
                sfx("join")
                self.after_change()
                return
        if data.get("type") == "hello" and guest is None and spec is None and \
                (data.get("spectate") or self.started or len(self.guests) + 1 >= MAX_PLAYERS):
            name = str(data.get("name", "관전자"))[:12]
            self.specs.append({"conn": conn, "name": name})
            send_json(conn, {"type": "you_spectate"})
            send_json(conn, {"type": "lobby", "names": self.lobby_names(), "avatars": self.lobby_avatars()})
            if self.started:
                send_json(conn, {"type": "avatars", "list": self.avatars})
                send_json(conn, {"type": "state", "state": self.game.to_dict(), "seat": -1, "specs": len(self.specs)})
            self.spec_changed(f"{name}님이 관전을 시작했어요")
            return
        if spec is not None:
            if data.get("type") in ("chat", "sticker") and chat is not None:
                name = f"{spec['name']}(관전)"
                if data["type"] == "chat":
                    text = str(data.get("text", ""))[:chat.MAX_TEXT]
                    self.receive_chat(name, None, text)
                    msg = {"type": "chat", "name": name, "seat": None, "text": text}
                elif data.get("id") in chat.STICKER_IDS:
                    self.receive_sticker(name, data["id"])
                    msg = {"type": "sticker", "name": name, "id": data["id"]}
                else:
                    return
                for c in self.listeners():
                    send_json(c, msg)
            return
        if data.get("type") == "hello" and guest is None and not self.started:
            names = {self.name_var.get().strip() or "방장"} | {g["name"] for g in self.guests}
            name, base, k = str(data.get("name", "참가자"))[:12], str(data.get("name", "참가자"))[:12], 2
            while name in names:
                name, k = f"{base}{k}", k + 1
            av = avatars.valid(data.get("avatar")) if avatars else None
            self.guests.append({"conn": conn, "name": name, "seat": None, "avatar": av})
            self.broadcast_lobby()
            self.toast(f"{name}님이 들어왔어요")
            self.root.bell()
            self.draw_dice()
        elif data.get("type") in ("chat", "sticker") and guest and chat is not None:
            seat = guest["seat"] if self.started else self.guests.index(guest) + 1
            if data["type"] == "chat":
                text = str(data.get("text", ""))[:chat.MAX_TEXT]
                self.receive_chat(guest["name"], seat, text)
                msg = {"type": "chat", "name": guest["name"], "seat": seat, "text": text}
            else:
                if data.get("id") not in chat.STICKER_IDS:
                    return
                self.receive_sticker(guest["name"], data["id"])
                msg = {"type": "sticker", "name": guest["name"], "id": data["id"]}
            for c in self.listeners():
                send_json(c, msg)
        elif data.get("type") == "emote" and guest and guest.get("seat") is not None:
            text = data.get("text")
            teabag = bool(data.get("teabag"))
            self.apply_emote(guest["seat"], text, teabag)
            for c in self.listeners():
                send_json(c, {"type": "emote", "seat": guest["seat"], "text": text, "teabag": teabag})
        elif data.get("type") == "act" and guest and self.started:
            self.do_action(guest["seat"], data.get("act"), i=data.get("i"), cat=data.get("cat"))

    def on_guest_msg(self, data):
        t = data.get("type")
        if t == "lobby":
            names = data["names"]
            old = getattr(self, "lobby_list", [])
            me = self.name_var.get().strip()
            for n in names:
                if old and n not in old and n != me:
                    self.toast(f"{n}님이 들어왔어요")
            for n in old:
                if n not in names:
                    self.toast(f"{n}님이 나갔어요")
            self.lobby_list = names
            self.lobby_avatar_list = [avatars.valid(a) if avatars else None for a in data.get("avatars", [])]
            self.lobby_text = "대기실에 들어왔어요"
            self.update_labels()
            self.draw_dice()
        elif t == "avatars":
            self.avatars = [avatars.valid(a) if avatars else None for a in data.get("list", [])]
        elif t == "you_spectate":
            self.spectating = True
            self.my_seat = -1
            self.lobby_text = "관전자로 들어왔어요"
            self.update_labels()
        elif t == "specs":
            self.spec_count = int(data.get("n", 0))
            self.spec_names = ui_kit.clean_names(data.get("names"))
            self.update_status()
        elif t == "state":
            game = YachtGame.from_dict(data["state"])
            if not self.started or self.game is None or game.roll_id < self.shown_roll_id:
                self.shown_roll_id = game.roll_id  # 새 게임 시작: 애니메이션 없이
                self.result_shown = False
            self.started = True
            self.game = game
            self.my_seat = data["seat"]
            self.spectating = self.my_seat < 0
            self.spec_count = int(data.get("specs", self.spec_count))
            if "spec_names" in data:
                self.spec_names = ui_kit.clean_names(data.get("spec_names"))
            self.after_change()
        elif t == "emote":
            self.apply_emote(int(data.get("seat", -1)), data.get("text"), bool(data.get("teabag")))
        elif t == "chat" and chat is not None:
            seat = data.get("seat")
            self.receive_chat(str(data.get("name", "?"))[:12], seat if isinstance(seat, int) else None,
                              data.get("text", ""))
        elif t == "sticker" and chat is not None:
            self.receive_sticker(str(data.get("name", "?"))[:12], data.get("id"))
        elif t == "full":
            messagebox.showwarning("네트워크", "이미 게임이 시작됐거나 방이 가득 찼습니다.")

    def on_disconnect(self, conn):
        if self.role == "guest" and conn is self.conn:
            self.conn = None
            if self.started and self.game and not self.game.over and not self.spectating:
                self.reconnect_until = time.monotonic() + 30  # 30초 동안 다시 접속해 봄
                self.toast("연결이 끊겼어요 · 다시 접속하는 중...")
                self.root.after(1500, self.try_reconnect)
                return
            self.role = None
            self.started = False
            messagebox.showwarning("네트워크", "방장과 연결이 끊어졌습니다.")
            if self.game:
                self.render()
            return
        spec = next((x for x in self.specs if x["conn"] is conn), None)
        if self.role == "host" and spec is not None:
            self.specs.remove(spec)
            self.spec_changed(f"{spec['name']}님이 관전을 그만뒀어요")
            return
        guest = next((g for g in self.guests if g["conn"] is conn), None)
        if self.role != "host" or guest is None:
            return
        self.guests.remove(guest)
        self.toast(f"{guest['name']}님이 나갔어요")
        if self.started and self.game and guest["seat"] is not None and not self.game.over:
            p = self.game.players[guest["seat"]]
            p["left"], p["ai"] = True, True  # 나간 사람 차례는 컴퓨터가 대신 둠
            self.after_change()
        else:
            self.broadcast_lobby()
            self.draw_dice()

    def try_reconnect(self):
        if not self.alive or not getattr(self, "reconnect_until", 0) or self.conn is not None:
            return
        if time.monotonic() > self.reconnect_until:
            self.reconnect_until = 0
            self.role, self.started = None, False
            messagebox.showwarning("네트워크", "방장과 다시 연결하지 못했어요.")
            return
        threading.Thread(target=self._connect, args=(self.join_ip,), daemon=True).start()

    def close_net(self):
        for s in [self.conn, self.server] + [g["conn"] for g in self.guests] + [x["conn"] for x in self.specs]:
            if s:
                try:
                    s.close()
                except OSError:
                    pass
        self.conn = self.server = None
        self.guests, self.specs = [], []
        self.role = None
        self.started = False

    def on_close(self):
        self.close_net()
        self.root.destroy()


def main():
    if sys.stdout is None or sys.stderr is None:
        # 창 모드 exe에는 출력할 곳이 없어서, 무언가 출력되는 순간 오류로 클릭 처리가 끊김 -> 로그 파일로 보냄
        import tempfile
        log = open(os.path.join(tempfile.gettempdir(), "mini_game_room.log"), "a", encoding="utf-8")
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log
    try:  # 고해상도 화면에서 흐릿하지 않게
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except (AttributeError, OSError, ImportError):
        pass
    root = tk.Tk()
    YachtApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
