"""오목 (tkinter)

실행: python omok/omok_game.py
- 15x15 판, 흑이 먼저 둠
- 룰: 쌍삼 금지(정확히 5목만 승리, 3-3 금지) / 자유룰(5목 이상이면 승리)
- 모드: 컴퓨터 대전 / 한 PC 2인 / 네트워크(같은 와이파이)
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

try:  # 광택 있는 돌 그림용 (없으면 단색 원으로 대신 그림)
    from PIL import Image, ImageDraw, ImageTk
except ImportError:
    Image = None
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hub"))  # 공통 모듈
import ui_kit  # 그라데이션 배경, 둥근 카드/버튼, 참가자 카드

try:  # 미니게임룸(hub)에서 실행하면 프로필 그림 / 결과 화면 / 채팅
    import avatars
except ImportError:
    avatars = None
try:
    import party
except ImportError:
    party = None
try:
    import chat
except ImportError:
    chat = None

PORT = 50009
UNDO_LIMIT = 2  # 컴퓨터 대전이 아니면 한 판에 무르기 기회 (사람마다)
MAX_LINE = 300_000  # 네트워크 메시지 한 줄 최대 길이 (프로필 사진 포함해도 충분)
N = 15
EMPTY, BLACK, WHITE = 0, 1, 2
DIRS = ((0, 1), (1, 0), (1, 1), (1, -1))
STARS = [(3, 3), (3, 11), (11, 3), (11, 11), (7, 7)]
RULES = {"33": ("쌍삼 금지", "정확히 5목만 승리 · 3-3 금지"), "free": ("자유룰", "5목 이상이면 승리")}


def other(c):
    return WHITE if c == BLACK else BLACK


def color_name(c):
    return "흑" if c == BLACK else "백"


def inside(r, c):
    return 0 <= r < N and 0 <= c < N


# ---------------------------------------------------------------- 규칙

class Board:
    def __init__(self, rule="33"):
        self.g = [[EMPTY] * N for _ in range(N)]
        self.moves = []
        self.rule = rule

    @property
    def turn(self):
        return BLACK if len(self.moves) % 2 == 0 else WHITE

    def run(self, r, c, dr, dc, color, extra=()):
        """(r, c)에 color를 놓았다고 칠 때 그 방향 연속 길이와 앞/뒤로 뻗은 수. extra 칸도 같은 색으로 침."""
        def same(rr, cc):
            return (rr, cc) in extra or (inside(rr, cc) and self.g[rr][cc] == color)
        f = 0
        while same(r + (f + 1) * dr, c + (f + 1) * dc):
            f += 1
        b = 0
        while same(r - (b + 1) * dr, c - (b + 1) * dc):
            b += 1
        return 1 + f + b, f, b

    def five_at(self, r, c, color):
        """(r, c)에 두면 이기는지. 쌍삼 금지 룰은 정확히 5목만 승리(6목 이상은 아님)."""
        exact = self.rule == "33"
        for dr, dc in DIRS:
            n, _, _ = self.run(r, c, dr, dc, color)
            if n == 5 or (n > 5 and not exact):
                return True
        return False

    def win_line(self, r, c, color):
        exact = self.rule == "33"
        for dr, dc in DIRS:
            n, f, b = self.run(r, c, dr, dc, color)
            if n == 5 or (n > 5 and not exact):
                return [(r + k * dr, c + k * dc) for k in range(-b, f + 1)]
        return []

    def open_three_dirs(self, r, c, color):
        """(r, c)에 두면 '열린 3'이 생기는 방향 수. 한 칸 더 두면 양쪽이 열린 4가 되는 줄을 열린 3으로 봄."""
        count = 0
        for dr, dc in DIRS:
            for k in range(-4, 5):
                qr, qc = r + k * dr, c + k * dc
                if k == 0 or not inside(qr, qc) or self.g[qr][qc] != EMPTY:
                    continue
                n, f, b = self.run(r, c, dr, dc, color, extra={(qr, qc)})
                if n != 4 or not -b <= k <= f:
                    continue
                ends = ((r + (f + 1) * dr, c + (f + 1) * dc), (r - (b + 1) * dr, c - (b + 1) * dc))
                if all(inside(*e) and self.g[e[0]][e[1]] == EMPTY for e in ends):
                    count += 1
                    break
        return count

    def forbidden(self, r, c, color):
        """쌍삼 금지 룰에서 둘 수 없는 자리 (5목이 완성되면 예외)."""
        if self.rule != "33" or self.g[r][c] != EMPTY:
            return False
        if self.five_at(r, c, color):
            return False
        return self.open_three_dirs(r, c, color) >= 2

    def legal(self, r, c):
        return inside(r, c) and self.g[r][c] == EMPTY and not self.forbidden(r, c, self.turn)

    def place(self, r, c):
        color = self.turn
        self.g[r][c] = color
        self.moves.append((r, c))
        return color

    def undo(self):
        r, c = self.moves.pop()
        self.g[r][c] = EMPTY

    def full(self):
        return len(self.moves) == N * N


# ---------------------------------------------------------------- 컴퓨터 AI

WINDOW_W = [0, 1, 14, 160, 2600, 100000]  # 5칸 창 안에 내 돌 수별 점수 (상대 돌이 섞이면 0)


def window_score(board, r, c, color):
    opp = other(color)
    total = 0
    for dr, dc in DIRS:
        for start in range(-4, 1):
            cnt = 0
            for k in range(start, start + 5):
                rr, cc = r + k * dr, c + k * dc
                if not inside(rr, cc) or board.g[rr][cc] == opp:
                    cnt = -1
                    break
                if k == 0 or board.g[rr][cc] == color:
                    cnt += 1
            if cnt > 0:
                total += WINDOW_W[min(cnt, 5)]
    return total


def ai_move(board, level="normal"):
    """level: easy(자주 놓침) / normal / hard(공격·수비 모두 꼼꼼히)"""
    color = board.turn
    opp = other(color)
    cands = set()
    for r, c in board.moves:
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                rr, cc = r + dr, c + dc
                if inside(rr, cc) and board.g[rr][cc] == EMPTY:
                    cands.add((rr, cc))
    if not cands:
        return (7, 7)
    legal = [p for p in cands if not board.forbidden(p[0], p[1], color)]
    if not legal:
        legal = [(r, c) for r in range(N) for c in range(N) if board.legal(r, c)]
    for p in legal:  # 이기는 수
        if board.five_at(p[0], p[1], color):
            return p
    for p in legal:  # 상대가 이기는 자리 막기 (쉬움은 가끔 놓침)
        if board.five_at(p[0], p[1], opp) and (level != "easy" or random.random() < 0.6):
            return p
    noise = {"easy": 900.0, "normal": 60.0}.get(level, 1.0)
    ranked = sorted(legal, key=lambda p: window_score(board, p[0], p[1], color) * 1.12 +
                    window_score(board, p[0], p[1], opp) + random.random() * noise, reverse=True)
    if level == "easy" and random.random() < 0.35:
        return random.choice(ranked[:6])
    return ranked[0]


try:  # 효과음 (없으면 조용히)
    import sound
except ImportError:
    sound = None


def sfx(name):
    if sound is not None:
        sound.play(name)


# ---------------------------------------------------------------- 네트워크 도우미

def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # 실제로 패킷을 보내지 않고 사용할 네트워크 인터페이스만 고름
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return socket.gethostbyname(socket.gethostname())


# ---------------------------------------------------------------- 화면

BG = "#16132B"
PANEL = "#221E3D"
CARD = "#2F2A52"
TEXT = "#F3F1FF"
MUTED = "#9F9AC8"
ACCENT = "#7C5CFF"
DANGER = "#FF5C7A"
GOLD = "#FFC94D"
WOOD = "#E3B36E"
LINE = "#5B3A1A"
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


def blend(c1, c2, t):
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02X%02X%02X" % tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def round_rect(cv, x0, y0, x1, y1, r, **kw):
    r = max(min(r, (x1 - x0) / 2, (y1 - y0) / 2), 0)
    pts = [x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r, x1, y1 - r, x1, y1,
           x1 - r, y1, x0 + r, y1, x0, y1, x0, y1 - r, x0, y0 + r, x0, y0]
    return cv.create_polygon(pts, smooth=True, **kw)


def make_button(parent, text, command, bg, on_bg=PANEL):
    """둥근 알약 버튼 (맥에서도 같은 색)."""
    return ui_kit.RoundButton(parent, text, command, bg=bg, font=(UI_FONT, 10, BOLD), on_bg=on_bg, pady=7)


def render_stone(color, size):
    """광택 있는 돌 이미지 (4배 크게 그린 뒤 줄여서 매끈하게)."""
    ss = 4
    w = size * ss
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = w * 0.06
    d.ellipse((pad + w * 0.03, pad + w * 0.06, w - pad + w * 0.03, w - pad + w * 0.06), fill=(60, 35, 10, 90))
    r0 = (w - 2 * pad) / 2
    cx = cy = w / 2
    edge, hi = (("#101014", "#6A6A74") if color == BLACK else ("#C9C3B8", "#FFFFFF"))
    steps = 40
    for k in range(steps):
        t = k / steps
        rad = r0 * (1 - t * 0.92)
        ox, oy = -r0 * 0.28 * t, -r0 * 0.32 * t
        col = blend(edge, hi, t ** 1.6)
        d.ellipse((cx + ox - rad, cy + oy - rad, cx + ox + rad, cy + oy + rad), fill=col)
    if color == BLACK:
        d.ellipse((cx - r0 * 0.5, cy - r0 * 0.62, cx - r0 * 0.12, cy - r0 * 0.36), fill=(255, 255, 255, 70))
    return img.resize((size, size), Image.LANCZOS)


class OmokApp:
    def __init__(self, root, parent=None, preset=None, on_back=None):
        """parent/preset/on_back은 미니게임룸에서 열 때 사용 (단독 실행이면 생략)."""
        self.root = root
        self.alive = True
        setup_fonts(root)
        host = parent or root
        if parent is None:
            root.title("오목")
            root.configure(bg=BG)
            root.geometry("1180x820")
            root.minsize(900, 640)
            root.protocol("WM_DELETE_WINDOW", self.on_close)
        preset = preset or {}
        self.nick = preset.get("name") or "나"
        self.my_avatar = preset.get("avatar")
        self.on_result = preset.get("on_result")
        self.opp_name = self.opp_avatar = None

        self.color_var = tk.StringVar(value=preset.get("color", "b"))
        self.mode_var = tk.StringVar(value=preset.get("mode", "ai"))
        self.rule_var = tk.StringVar(value=preset.get("rule", "33"))
        self.level = preset.get("level", "normal")
        self.mode = self.mode_var.get()
        self.player = BLACK
        self.board = Board()
        self.over = False
        self.winner = None
        self.resigned = None  # 항복한 색
        self.win_cells = []
        self.hover = None
        self.drop = None
        self.thinking = False
        self.game_id = 0
        self.images = {}
        self.conn = self.server = None
        self.net_ready = False
        self.net_queue = queue.Queue()
        self.specs = []  # 방장: 관전자들 [{"conn", "name"}]
        self.pending = set()  # 방장: 아직 플레이어/관전 여부를 안 밝힌 연결
        self.spectating = False  # 나는 관전자
        self.spec_count = 0
        self.spec_names = []  # 관전자 이름 (방장이 알려 줌)
        self.watch_names, self.watch_avatars = ["?", "?"], [None, None]
        self.result = None
        self.result_hits = []
        self.fx_bubbles, self.teabag, self.fx_on, self.last_emote = {}, None, False, 0.0
        self.popups = []

        self.surface = ui_kit.Surface(host)  # 창 전체 배경
        self.surface.pack(fill="both", expand=True)
        host = self.surface
        panel = ui_kit.Surface(host, width=310)
        panel.pack(side="right", fill="y", padx=(0, 16), pady=16)
        panel.pack_propagate(False)
        self.panel = panel
        panel.bind("<Configure>", lambda e: self.fit_panel(), add="+")
        self.cv = tk.Canvas(host, bg=BG, highlightthickness=0)
        self.cv.pack(side="left", fill="both", expand=True, padx=16, pady=16)
        self.cv.bind("<Configure>", lambda e: self.draw())
        self.cv.bind("<Motion>", self.on_motion)
        self.cv.bind("<Leave>", lambda e: self.set_hover(None))
        self.cv.bind("<Button-1>", self.on_click)

        card = ui_kit.Card(panel)
        card.pack(fill="x")
        self.settings_card = card
        card = card.body
        if on_back:
            make_button(card, "←  메뉴로", on_back, CARD).pack(fill="x", padx=12, pady=(12, 0))
        else:
            self._segment(card, "내 돌", self.color_var, [("b", "흑 (선공)"), ("w", "백")])
            self._segment(card, "상대", self.mode_var, [("ai", "컴퓨터"), ("pvp", "2인"), ("net", "네트워크")])
            self._segment(card, "룰", self.rule_var, [(k, v[0]) for k, v in RULES.items()])
        btns = tk.Frame(card, bg=PANEL)
        btns.pack(fill="x", padx=12, pady=12)
        make_button(btns, "새 게임", self.new_game, ACCENT).pack(side="left", fill="x", expand=True)
        self.undo_btn = make_button(btns, "무르기", self.undo, CARD)
        self.undo_btn.pack(side="left", fill="x", expand=True, padx=(6, 0))
        make_button(btns, "항복", self.resign, DANGER).pack(side="left", fill="x", expand=True, padx=(6, 0))

        self.top_card = self._player_card(panel)
        self.top_card["frame"].pack(fill="x", pady=(14, 0))
        self.status_card = ui_kit.Card(panel, radius=16)
        self.status_card.pack(fill="x", pady=(10, 8))
        self.status = tk.Label(self.status_card.body, bg=PANEL, fg=TEXT, font=(UI_FONT, 11, BOLD), anchor="w",
                               justify="left", wraplength=272)
        self.status.pack(fill="x", padx=4, pady=(2, 0))
        self.info = tk.Label(self.status_card.body, bg=PANEL, fg=MUTED, font=(UI_FONT, 9, BOLD), anchor="w",
                             justify="left", wraplength=272)
        self.info.pack(fill="x", padx=4, pady=(2, 2))
        self.people_card = ui_kit.PeopleCard(panel, UI_FONT, BOLD)  # 네트워크 대전: 참가자 현황
        self.bottom_card = self._player_card(panel)
        self.bottom_card["frame"].pack(side="bottom", fill="x")
        self.chat_panel = None
        if chat is not None:
            chat_card = ui_kit.Card(panel, stretch=True)
            chat_card.pack(side="bottom", fill="both", expand=True, pady=(0, 10))
            self.chat_panel = chat.ChatPanel(chat_card.body, (PANEL, CARD, TEXT, MUTED, ACCENT), UI_FONT, BOLD,
                                             self.send_chat, self.send_sticker, lines=3)
            self.chat_panel.pack(fill="both", expand=True)

        self.root.after(100, self.poll_net)
        if preset.get("mode") == "net":
            self.mode = "net"
            self.player = BLACK if self.color_var.get() == "b" else WHITE
            self.reset_board()
            if preset.get("net") in ("join", "watch"):
                self.join(preset.get("ip", ""), spectate=preset.get("net") == "watch")
            else:
                self.host()
        else:
            self.new_game()

    # ---- 위젯 도우미
    def _segment(self, parent, label, var, options):
        row = tk.Frame(parent, bg=PANEL)
        row.pack(fill="x", padx=12, pady=(10, 0))
        tk.Label(row, text=label, bg=PANEL, fg=MUTED, font=(UI_FONT, 9)).pack(anchor="w")
        seg = tk.Frame(row, bg=PANEL)
        seg.pack(fill="x", pady=(3, 0))
        ui_kit.segment(seg, var, options, (UI_FONT, 10, BOLD))

    @staticmethod
    def _player_card(parent):
        card = ui_kit.Card(parent, fill=CARD, radius=18, pad=4)
        f = card.body
        pic = tk.Canvas(f, width=40, height=40, bg=CARD, highlightthickness=0)
        pic.pack(side="left", padx=(10, 0), pady=8)
        name = tk.Label(f, bg=CARD, fg=TEXT, font=(UI_FONT, 11, BOLD), anchor="w")
        name.pack(side="left", padx=10)
        stone = tk.Canvas(f, width=30, height=30, bg=CARD, highlightthickness=0)
        stone.pack(side="right", padx=12)
        return {"frame": card, "pic": pic, "name": name, "stone": stone}

    # ---- 게임 진행
    def new_game(self):
        if self.spectating:
            return
        if self.mode_var.get() == "net" or self.mode == "net":
            if self.conn and self.net_ready:
                self.send({"type": "new", "rule": self.board.rule})
                self.reset_board()
            elif not self.conn:
                messagebox.showinfo("오목", "네트워크 대전은 미니게임룸 메뉴에서 방을 만들거나 참가해 주세요.")
            return
        self.close_net()
        self.mode = self.mode_var.get()
        self.player = BLACK if self.color_var.get() == "b" else WHITE
        self.reset_board()

    def reset_board(self, rule=None):
        self.board = Board(rule or self.rule_var.get())
        self.over, self.winner, self.win_cells, self.resigned = False, None, [], None
        self.undos_left = {BLACK: UNDO_LIMIT, WHITE: UNDO_LIMIT}  # 컴퓨터 대전이 아니면 사람마다
        self.undo_pending = False
        self.hover = self.drop = None
        self.thinking = False
        self.result = None
        self.game_id += 1
        self.refresh()
        self.schedule_ai()

    def is_ai_turn(self):
        return self.mode == "ai" and not self.over and self.board.turn != self.player

    def can_place(self):
        if self.over or self.thinking or self.drop:
            return False
        if self.mode == "ai":
            return self.board.turn == self.player
        if self.mode == "net":
            return bool(self.conn) and self.net_ready and not self.spectating and self.board.turn == self.player
        return True

    def play(self, r, c, remote=False):
        b = self.board
        if self.over or not b.legal(r, c):
            return False
        color = b.turn
        wins = b.five_at(r, c, color)
        if self.mode == "net" and not remote:
            self.send({"type": "move", "r": r, "c": c})
        b.place(r, c)
        sfx("place")
        self.drop = {"rc": (r, c), "t0": time.monotonic()}
        self.hover = None
        if wins:
            self.over, self.winner = True, color
            self.win_cells = b.win_line(r, c, color)
        elif b.full():
            self.over, self.winner = True, None
        self.refresh()
        self.root.after(16, self.drop_step)
        if self.over:
            gid = self.game_id
            self.root.after(900, lambda: gid == self.game_id and self.open_result())
        else:
            self.schedule_ai()
        return True

    def drop_step(self):
        if not self.alive or not self.drop:
            return
        if time.monotonic() - self.drop["t0"] > 0.18:
            self.drop = None
        self.draw()
        if self.drop:
            self.root.after(16, self.drop_step)

    def schedule_ai(self):
        if self.is_ai_turn() and not self.thinking:
            self.thinking = True
            self.refresh()
            gid = self.game_id
            self.root.after(380, lambda: self.ai_step(gid))

    def ai_step(self, gid):
        if not self.alive or gid != self.game_id:
            return
        self.thinking = False
        if self.is_ai_turn():
            self.play(*ai_move(self.board, getattr(self, "level", "normal")))

    def undo(self):
        if self.thinking or not self.board.moves or self.spectating:
            return
        if self.mode == "ai":  # 컴퓨터 대전은 무제한 (내 차례까지 되돌림)
            self.board.undo()
            while self.board.moves and self.board.turn != self.player:
                self.board.undo()
            self._after_undo()
            return
        mover = other(self.board.turn)  # 방금 둔 사람
        if self.mode == "net":
            if not (self.conn and self.net_ready) or self.undo_pending:
                return
            if self.over or mover != self.player:
                self.note("내가 방금 둔 수만, 상대가 두기 전에 무를 수 있어요")
                return
        if self.undos_left[mover] <= 0:
            self.note(f"무르기 기회를 다 썼어요 (한 판에 {UNDO_LIMIT}번)")
            return
        if self.mode == "net":
            self.undo_pending = True
            self.send({"type": "undo_req", "n": len(self.board.moves)})
            self.status.config(text="무르기 요청 중...")
            return
        self.undos_left[mover] -= 1
        self.board.undo()
        self._after_undo()
        self.note(f"{color_name(mover)} 무르기 (남은 기회 {self.undos_left[mover]}번)")

    def on_undo_req(self, n):
        """상대가 방금 둔 수를 무르자고 함: 내가 아직 안 뒀으면 받아 줌."""
        mover = other(self.board.turn)
        ok = (not self.over and n == len(self.board.moves) and self.board.moves and mover != self.player
              and self.undos_left[mover] > 0)
        if ok:
            self.undos_left[mover] -= 1
            self.board.undo()
            self._after_undo()
            self.note(f"상대가 한 수 물렀어요 (남은 기회 {self.undos_left[mover]}번)")
        self.send({"type": "undo_ok" if ok else "undo_no"})

    def on_undo_answer(self, ok):
        if not self.undo_pending:
            return
        self.undo_pending = False
        if ok:
            self.undos_left[self.player] -= 1
            self.board.undo()
            self._after_undo()
            self.note(f"한 수 물렀어요 (남은 기회 {self.undos_left[self.player]}번)")
        else:
            self.note("상대가 이미 둬서 무를 수 없어요")
            self.refresh()

    def resume_from(self, data):
        """참가자: 다시 접속했을 때 방장이 보내 준 판으로 이어서."""
        self.reconnect_until = 0
        self.spectating, self.net_ready = False, True
        self.player = WHITE if data.get("color") == WHITE else BLACK
        self.opp_name = str(data.get("name", ""))[:12] or None
        self.opp_avatar = avatars.valid(data.get("avatar")) if avatars else None
        rule = data.get("rule") if data.get("rule") in RULES else "33"
        self.rule_var.set(rule)
        self.reset_board(rule)
        for m in data.get("moves", []):
            if isinstance(m, list) and len(m) == 2 and self.board.legal(*m):
                self.board.place(*m)
        undos = data.get("undos") or {}
        for color in (BLACK, WHITE):
            try:
                self.undos_left[color] = int(undos.get(str(color), UNDO_LIMIT))
            except (TypeError, ValueError):
                pass
        self.note("다시 연결됐어요! 이어서 해요")
        sfx("join")
        self.refresh()

    # ---- 연결이 끊겼을 때 다시 접속 (참가자)
    def start_reconnect(self):
        self.reconnect_until = time.monotonic() + 30
        self.note("연결이 끊겼어요 · 30초 동안 다시 접속해 볼게요")
        self.root.after(1500, self.try_reconnect)

    def try_reconnect(self):
        if not self.alive or not getattr(self, "reconnect_until", 0) or self.conn is not None:
            return
        if time.monotonic() > self.reconnect_until:
            self.reconnect_until = 0
            messagebox.showwarning("네트워크", "방장과 다시 연결하지 못했어요.")
            return
        threading.Thread(target=self._connect, args=(self.join_ip,), daemon=True).start()

    def _after_undo(self):
        self.over, self.winner, self.win_cells, self.result, self.resigned = False, None, [], None, None
        self.game_id += 1
        self.refresh()
        self.schedule_ai()

    def note(self, text):
        """짧은 알림: 채팅 칸에 회색 글씨로."""
        if self.chat_panel:
            self.chat_panel.add("", text, system=True)
        else:
            self.status.config(text=text)

    def resign(self):
        if self.over or self.spectating or (self.mode == "net" and not (self.conn and self.net_ready)):
            return
        color = self.player if self.mode in ("ai", "net") else self.board.turn
        if messagebox.askyesno("항복", f"{self.player_name(color)} 항복할까요?"):
            self.do_resign(color)

    def do_resign(self, color, notify=True):
        if self.over or color not in (BLACK, WHITE):
            return
        self.over, self.winner, self.resigned = True, other(color), color
        self.thinking = False
        self.game_id += 1
        if self.mode == "net" and notify:
            self.send({"type": "resign", "color": color})
        self.refresh()
        gid = self.game_id
        self.root.after(300, lambda: gid == self.game_id and self.open_result())

    # ---- 표시
    def player_name(self, color):
        if self.spectating:
            return self.watch_names[0 if color == BLACK else 1] or "?"
        if self.mode == "pvp":
            return f"{color_name(color)} 플레이어"
        if color == self.player:
            return self.nick
        return "컴퓨터" if self.mode == "ai" else (self.opp_name or "상대")

    def avatar_for(self, color):
        if avatars is None:
            return None
        if self.spectating:
            return avatars.valid(self.watch_avatars[0 if color == BLACK else 1]) or \
                avatars.default_avatar(0 if color == BLACK else 1)
        if self.mode == "pvp":
            return avatars.default_avatar(0 if color == BLACK else 1)
        if color == self.player:
            return self.my_avatar
        return avatars.robot_avatar() if self.mode == "ai" else self.opp_avatar

    def refresh(self):
        b = self.board
        if self.over and self.resigned:
            text = f"{self.player_name(self.resigned)} 항복! {self.player_name(self.winner)} 승리"
        elif self.over:
            text = "무승부!" if self.winner is None else f"5목 완성! {self.player_name(self.winner)} 승리"
        elif self.mode == "net" and not self.net_ready:
            text = getattr(self, "net_text", "상대를 기다리는 중...")
        elif self.thinking:
            text = "컴퓨터가 생각 중..."
        else:
            text = f"{color_name(b.turn)} 차례 · {self.player_name(b.turn)}"
        if self.spectating:
            text = "관전 중  ·  " + text
        self.status.config(text=text, fg=GOLD if self.over else TEXT)
        n_specs = len(self.specs) if self.specs else len(self.spec_names)
        watch = f"   ·   관전 {n_specs}명" if self.mode == "net" and n_specs else ""
        self.info.config(text=f"{RULES[b.rule][0]}   ·   {len(b.moves)}수{watch}")
        self.update_people()
        if self.mode == "ai" or self.spectating:
            self.undo_btn.config(text="무르기")
        else:
            who = self.player if self.mode == "net" else other(b.turn)
            self.undo_btn.config(text=f"무르기 {self.undos_left[who]}")
        bottom = self.player if self.mode != "pvp" else BLACK
        for card, color in ((self.bottom_card, bottom), (self.top_card, other(bottom))):
            active = not self.over and b.turn == color
            bg = "#F2F2EE" if active else CARD
            for key in ("frame", "pic", "stone"):
                card[key].config(bg=bg)
            card["name"].config(bg=bg, fg=BG if active else TEXT, text=self.player_name(color))
            card["pic"].delete("all")
            if avatars is not None:
                avatars.draw_avatar(card["pic"], 20, 20, 36, self.avatar_for(color) or avatars.default_avatar(2))
            card["stone"].delete("all")
            self.place_stone(card["stone"], color, 15, 15, 24)
        self.draw()
        if self.specs:
            self.send_specs(self.snapshot())

    def update_people(self):
        """네트워크 대전일 때 오른쪽에 플레이어와 관전자 목록."""
        if self.mode != "net":
            self.people_card.pack_forget()
            return
        players = []
        for color in (BLACK, WHITE):
            mine = not self.spectating and color == self.player
            turn = self.board.turn == color and not self.over
            players.append((self.avatar_for(color), self.player_name(color) + ("  (나)" if mine else ""),
                            color_name(color) + ("  ·  차례" if turn else ""), turn))
        specs = [x["name"] for x in self.specs] if self.specs else list(self.spec_names)
        if self.spectating and self.nick not in specs:
            specs.append(self.nick)
        if self.people_card.mode and not self.people_card.winfo_ismapped():
            self.people_card.pack(fill="x", pady=(0, 8), after=self.status_card)
        self.people_card.update_people(players, specs)
        self.fit_panel()

    def fit_panel(self):
        """창이 낮으면 참가자 -> 채팅 순서로 줄여서 오른쪽 칸이 넘치지 않게."""
        def run():
            if not self.alive:
                return
            ui_kit.fit_side_panel(
                self.panel, self.people_card if self.mode == "net" else None,
                lambda: self.people_card.pack(fill="x", pady=(0, 8), after=self.status_card), self.chat_panel,
                lines=(3, 2))
        ui_kit.schedule(self.panel, "fit", run)

    def specs_msg(self):
        return {"type": "specs", "n": len(self.specs), "names": [x["name"] for x in self.specs][:20]}

    def stone_image(self, color, size):
        key = (color, size)
        if key not in self.images:
            if len(self.images) > 12:
                self.images.clear()
            self.images[key] = ImageTk.PhotoImage(render_stone(color, size))
        return self.images[key]

    def place_stone(self, cv, color, x, y, size, tags=()):
        size = max(int(size), 6)
        if Image is not None:
            cv.create_image(x, y, image=self.stone_image(color, size), tags=tags)
        else:
            r = size * 0.44
            cv.create_oval(x - r, y - r, x + r, y + r, fill="#111" if color == BLACK else "#F5F2EA",
                           outline="#000" if color == BLACK else "#AAA", tags=tags)

    def board_box(self):
        ox, oy, size, g = self.geometry()
        return ox, oy, ox + size, oy + size, 22

    def geometry(self):
        W, H = self.cv.winfo_width(), self.cv.winfo_height()
        size = max(min(W, H) - 10, 100)
        g = size / (N + 1)
        return (W - size) / 2, (H - size) / 2, size, g

    def point(self, r, c):
        return self.ox + self.gap * (c + 1), self.oy + self.gap * (r + 1)

    def draw(self):
        cv = self.cv
        if not self.alive:
            return
        cv.delete("!bg")
        ui_kit.paint_backdrop(cv)
        ox, oy, size, g = self.geometry()
        self.ox, self.oy, self.gap = ox, oy, g
        # 나무 판
        ui_kit.round_rect(cv, ox + 8, oy + 12, ox + size + 8, oy + size + 14, 22, "#0E0B22")
        ui_kit.round_rect(cv, ox, oy, ox + size, oy + size, 22, WOOD, outline="#B98546", width=3)
        rnd = random.Random(3)
        for k in range(28):  # 나뭇결
            y = oy + 8 + rnd.uniform(0, size - 16)
            pts = []
            for x in range(int(ox + 10), int(ox + size - 10), 24):
                pts += [x, y + rnd.uniform(-2, 2)]
            cv.create_line(pts, fill=blend(WOOD, "#B07C3C", rnd.uniform(0.2, 0.45)), smooth=True)
        x0, y0 = self.point(0, 0)
        x1, y1 = self.point(N - 1, N - 1)
        for i in range(N):
            x, y = self.point(i, i)
            w = 2 if i in (0, N - 1) else 1
            cv.create_line(x0, y, x1, y, fill=LINE, width=w)
            cv.create_line(x, y0, x, y1, fill=LINE, width=w)
        for r, c in STARS:
            x, y = self.point(r, c)
            cv.create_oval(x - 4, y - 4, x + 4, y + 4, fill=LINE, outline="")
        lf = (UI_FONT, -max(int(g * 0.28), 9), BOLD)
        for i in range(N):
            x, y = self.point(i, i)
            cv.create_text(x, oy + g * 0.45, text="ABCDEFGHJKLMNOP"[i], fill=blend(LINE, WOOD, 0.3), font=lf)
            cv.create_text(ox + g * 0.45, y, text=str(N - i), fill=blend(LINE, WOOD, 0.3), font=lf)

        # 돌
        b = self.board
        stone = g * 0.94
        for r in range(N):
            for c in range(N):
                color = b.g[r][c]
                if not color:
                    continue
                x, y = self.point(r, c)
                s = stone
                if self.drop and self.drop["rc"] == (r, c):  # 탁 내려놓는 느낌
                    t = min((time.monotonic() - self.drop["t0"]) / 0.18, 1)
                    s = stone * (1.35 - 0.35 * (1 - (1 - t) ** 3))
                self.place_stone(cv, color, x, y, s)
        if b.moves:  # 마지막 수 표시
            r, c = b.moves[-1]
            x, y = self.point(r, c)
            cv.create_oval(x - g * 0.12, y - g * 0.12, x + g * 0.12, y + g * 0.12, fill=DANGER, outline="")
        if self.win_cells:
            (ar, ac), (br, bc) = self.win_cells[0], self.win_cells[-1]
            ax, ay = self.point(ar, ac)
            bx, by = self.point(br, bc)
            cv.create_line(ax, ay, bx, by, fill=GOLD, width=max(g * 0.22, 4), capstyle="round")
        self.draw_hover()
        self.draw_result()
        self.draw_popups()

    def draw_hover(self):
        cv = self.cv
        cv.delete("hover")
        if not self.hover or not self.can_place():
            return
        r, c = self.hover
        x, y = self.point(r, c)
        g = self.gap
        if self.board.forbidden(r, c, self.board.turn):
            d = g * 0.28
            cv.create_line(x - d, y - d, x + d, y + d, fill=DANGER, width=4, tags="hover")
            cv.create_line(x - d, y + d, x + d, y - d, fill=DANGER, width=4, tags="hover")
            return
        rad = g * 0.44
        dark = self.board.turn == BLACK
        cv.create_oval(x - rad, y - rad, x + rad, y + rad, outline="#222" if dark else "#FFF", width=2,
                       dash=(4, 3), tags="hover")
        cv.create_oval(x - rad * 0.3, y - rad * 0.3, x + rad * 0.3, y + rad * 0.3,
                       fill="#222" if dark else "#FFF", outline="", tags="hover")

    # ---- 입력
    def cell_at(self, x, y):
        if not hasattr(self, "gap"):
            return None
        c = round((x - self.ox) / self.gap - 1)
        r = round((y - self.oy) / self.gap - 1)
        if not inside(r, c):
            return None
        px, py = self.point(r, c)
        return (r, c) if abs(px - x) < self.gap * 0.48 and abs(py - y) < self.gap * 0.48 else None

    def set_hover(self, rc):
        if rc != self.hover:
            self.hover = rc
            self.draw_hover()
            if rc and self.can_place() and self.board.forbidden(rc[0], rc[1], self.board.turn):
                self.status.config(text="쌍삼(3-3) 금지 자리예요", fg=DANGER)
            elif not self.over:
                self.refresh_status_only()

    def refresh_status_only(self):
        b = self.board
        if self.thinking:
            self.status.config(text="컴퓨터가 생각 중...", fg=TEXT)
        elif not (self.mode == "net" and not self.net_ready):
            self.status.config(text=f"{color_name(b.turn)} 차례 · {self.player_name(b.turn)}", fg=TEXT)

    def on_motion(self, e):
        if self.result:
            return
        rc = self.cell_at(e.x, e.y)
        self.set_hover(rc if rc and self.board.g[rc[0]][rc[1]] == EMPTY else None)

    def on_click(self, e):
        if self.result:  # 결과 카드가 떠 있으면 카드 버튼만
            for x0, y0, x1, y1, action in self.result_hits:
                if x0 <= e.x <= x1 and y0 <= e.y <= y1:
                    action()
                    return
            return
        rc = self.cell_at(e.x, e.y)
        if rc and self.can_place():
            if self.board.forbidden(rc[0], rc[1], self.board.turn):
                self.status.config(text="쌍삼(3-3) 금지 자리예요", fg=DANGER)
                return
            self.play(*rc)

    # ---- 채팅 / 스티커
    def my_chat_name(self):
        if self.spectating:
            return f"{self.nick}(관전)"
        return "나" if self.mode == "pvp" else self.nick

    def send_chat(self, text):
        self.chat_panel.add(self.my_chat_name(), text, "#FF8FB1")
        if self.mode == "net" and self.conn:
            self.send({"type": "chat", "text": text, "name": self.nick})
            self.send_specs({"type": "chat", "text": text, "name": self.nick})
        elif self.mode == "ai" and random.random() < 0.6:
            gid = self.game_id
            self.root.after(1200, lambda: self.alive and gid == self.game_id and
                            self.chat_panel.add("컴퓨터", random.choice(chat.AI_TEXTS), "#3DDC97"))

    def send_sticker(self, sid):
        self.show_sticker(sid, self.my_chat_name())
        if self.mode == "net" and self.conn:
            self.send({"type": "sticker", "id": sid, "name": self.nick})
            self.send_specs({"type": "sticker", "id": sid, "name": self.nick})
        elif self.mode == "ai" and random.random() < 0.5:
            gid = self.game_id
            self.root.after(1400, lambda: self.alive and gid == self.game_id and
                            self.show_sticker(random.choice(chat.STICKERS)[0], "컴퓨터"))

    def show_sticker(self, sid, name):
        mine = name == self.my_chat_name()
        self.popups.append(chat.new_popup(sid, name, "me" if mine else "opp"))
        self.start_fx()

    def draw_popups(self):
        cv = self.cv
        cv.delete("popup")
        if chat is None or not self.popups or not hasattr(self, "gap"):
            return
        ox, oy, size, g = self.geometry()
        x = ox + size - g * 1.3
        spots = {"me": (x, oy + size - g * 1.6), "opp": (x, oy + g * 1.4), None: (x, oy + size / 2)}
        chat.draw_popups(cv, self.popups, lambda p: spots.get(p["who"], spots[None]), g * 1.7,
                         (UI_FONT, 9, BOLD), tags="popup")

    # ---- 결과 카드: 멘트, 티배깅
    def viewer_color(self):
        if self.mode in ("ai", "net"):
            return self.player
        return self.winner or BLACK

    def open_result(self):
        if not self.alive or not self.over:
            return
        if party is None:
            messagebox.showinfo("게임 종료", self.status["text"])
            return
        n = len(self.board.moves)
        comments = ["무승부" if self.winner is None else ("항복승!" if self.resigned else "5목 완성!")]
        if self.winner and not self.resigned:
            comments.append(f"{(n + 1) // 2}수 만에 승리!" if n > 20 else f"단 {(n + 1) // 2}수 만에 끝!")
        self.result = {"winner": self.winner, "comments": comments, "tally": ""}
        viewer = self.viewer_color()
        kind = "draw" if self.winner is None else ("win" if viewer == self.winner else "lose")
        self.result["opts"] = [] if self.spectating else party.pick_lines(kind)
        if self.on_result and self.mode in ("ai", "net") and not self.spectating:
            me, opp = self.nick, ("컴퓨터" if self.mode == "ai" else (self.opp_name or "상대"))
            winners = [] if self.winner is None else [me if self.winner == self.player else opp]
            tally = self.on_result("omok", [me, opp], winners)
            self.result["tally"] = "누적 우승   " + "  ·  ".join(f"{x} {tally.get(x, 0)}회" for x in (me, opp))
        self.result["question"] = party.question_for(self.player_name(BLACK), self.player_name(WHITE),
                                                     len(self.board.moves))
        if self.winner and not self.spectating:
            sfx("win" if self.winner == viewer else "lose")
            if self.chat_panel and self.mode == "net":
                self.chat_panel.add("", f"💬 질문 카드  {self.player_name(other(self.winner))}님: "
                                        f"{self.result['question']}", system=True)
        self.fx_bubbles, self.teabag = {}, None
        self.hover = None
        self.draw()

    def close_result(self):
        self.result = None
        self.draw()

    def send_emote(self, text=None, teabag=False):
        now = time.monotonic()
        if not self.result or now - self.last_emote < 0.6 or self.spectating or \
                (teabag and (self.result["winner"] is None or self.viewer_color() != self.result["winner"])):
            return  # 진 사람은 티배깅 못 함
        self.last_emote = now
        color = self.viewer_color()
        self.apply_emote(color, text, teabag)
        if self.mode == "net":
            self.send({"type": "emote", "color": color, "text": text, "teabag": teabag})
            self.send_specs({"type": "emote", "color": color, "text": text, "teabag": teabag})
        elif self.mode == "ai":
            ai = other(self.player)
            kind = "draw" if self.result["winner"] is None else ("win" if self.result["winner"] == ai else "lose")
            gid = self.game_id
            self.root.after(1300, lambda: self.alive and gid == self.game_id and
                            self.apply_emote(ai, party.reply_line(kind)))

    def apply_emote(self, color, text=None, teabag=False):
        if not self.result or color not in (BLACK, WHITE):
            return
        now = time.monotonic()
        if teabag and color != self.result["winner"]:
            return
        if teabag:
            self.teabag = {"actor": color, "target": other(color), "t0": now}
            party.teabag_sounds(self.root)
            self.fx_bubbles[color] = ("티배깅!", now + 1.2)
        elif text:
            self.fx_bubbles[color] = (str(text)[:24], now + 3.5)
        self.start_fx()

    def start_fx(self):
        if not self.fx_on:
            self.fx_on = True
            self.root.after(16, self.fx_loop)

    def fx_active(self):
        now = time.monotonic()
        if self.teabag and now - self.teabag["t0"] >= party.TEABAG_TIME:
            self.teabag = None
        pops = chat is not None and any(now - p["t0"] < chat.POPUP_TIME for p in self.popups)
        return bool(self.teabag) or pops or any(exp > now for _, exp in self.fx_bubbles.values())

    def fx_loop(self):
        if not self.alive:
            self.fx_on = False
            return
        active = self.fx_active()
        self.draw_result(dyn=True)
        self.draw_popups()
        if active:
            self.root.after(16, self.fx_loop)
        else:
            self.fx_on = False

    def draw_result(self, dyn=False):
        cv = self.cv
        res = self.result
        if not dyn or not res:
            cv.delete("result")
        if not res or party is None:
            self.result_hits = []
            return
        winner = res["winner"]
        can_tb = bool(winner) and not self.spectating and self.viewer_color() == winner
        self.result_hits = party.draw_duel_result(
            cv, (0, 0, cv.winfo_width(), cv.winfo_height()), res, winner or BLACK, other, self.player_name,
            self._result_avatar, self.teabag, self.fx_bubbles, time.monotonic(), can_tb, (UI_FONT, NUM_FONT, BOLD),
            self.close_result, lambda t: self.send_emote(text=t), lambda: self.send_emote(teabag=True),
            (GOLD, TEXT, MUTED, DANGER, CARD, BG), dyn=dyn, dim_box=self.board_box())

    def _result_avatar(self, cv, x, y, size, color, tags="result"):
        if avatars is not None:
            avatars.draw_avatar(cv, x, y, size, self.avatar_for(color) or avatars.default_avatar(2), tags=tags,
                                ring="white")
        else:
            self.place_stone(cv, color, x, y, size, tags=tags)

    # ---- 네트워크 (같은 와이파이, 1:1)
    def host(self):
        self.close_net()
        try:
            srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            srv.bind(("", PORT))
            srv.listen(8)
        except OSError as e:
            messagebox.showerror("네트워크", f"방을 만들 수 없습니다: {e}")
            return
        self.server = srv
        self.net_text = f"상대를 기다리는 중...  내 IP: {local_ip()}"
        self.refresh()
        threading.Thread(target=self._accept_loop, args=(srv,), daemon=True).start()

    def _accept_loop(self, srv):
        while True:
            try:
                conn, _ = srv.accept()
            except OSError:
                return  # 방을 닫음
            self.net_queue.put(("incoming", conn, None))

    def join(self, ip, spectate=False):
        if not ip:
            return
        self.close_net()
        self.want_spectate = spectate
        self.join_ip, self.reconnect_until = ip, 0
        self.net_text = f"{ip} 에 접속하는 중..."
        self.refresh()
        threading.Thread(target=self._connect, args=(ip,), daemon=True).start()

    def _connect(self, ip):
        try:
            conn = socket.create_connection((ip, PORT), timeout=5)
            conn.settimeout(None)
        except OSError as e:
            self.net_queue.put(("error", None, f"접속 실패: {e}"))
            return
        self.net_queue.put(("connected", conn, "guest"))

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

    def send(self, obj):
        self.send_to(self.conn, obj)

    @staticmethod
    def send_to(conn, obj):
        try:
            conn.sendall((json.dumps(obj) + "\n").encode("utf-8"))
        except (OSError, AttributeError):
            pass

    def send_specs(self, obj, exclude=None):
        for x in self.specs:
            if x["conn"] is not exclude:
                self.send_to(x["conn"], obj)

    def snapshot(self):
        """관전자에게 보내는 지금 판 전체."""
        names = [self.player_name(BLACK), self.player_name(WHITE)]
        avs = [self.my_avatar if self.player == BLACK else self.opp_avatar,
               self.my_avatar if self.player == WHITE else self.opp_avatar]
        return {"type": "snapshot", "moves": [list(m) for m in self.board.moves], "rule": self.board.rule,
                "names": names, "avatars": avs, "over": self.over, "winner": self.winner,
                "resigned": self.resigned, "specs": len(self.specs),
                "spec_names": [x["name"] for x in self.specs][:20]}

    def apply_snapshot(self, s):
        """관전자: 받은 판으로 화면을 맞춤 (한 수만 늘었으면 돌 놓는 애니메이션)."""
        self.spectating, self.mode, self.player, self.net_ready = True, "net", BLACK, True
        self.watch_names = list(s.get("names", ["?", "?"]))[:2]
        self.watch_avatars = list(s.get("avatars", [None, None]))[:2]
        self.spec_count = int(s.get("specs", 0))
        self.spec_names = ui_kit.clean_names(s.get("spec_names"))
        rule = s.get("rule") if s.get("rule") in RULES else "33"
        moves = [tuple(m) for m in s.get("moves", [])]
        cur = list(self.board.moves)
        if rule == self.board.rule and moves[:len(cur)] == cur and len(moves) == len(cur) + 1:
            self.board.place(*moves[-1])
            self.drop = {"rc": moves[-1], "t0": time.monotonic()}
            self.root.after(16, self.drop_step)
        elif moves != cur or rule != self.board.rule:
            self.board = Board(rule)
            for m in moves:
                self.board.place(*m)
            self.result = None
        was_over = self.over
        self.over, self.winner, self.resigned = bool(s.get("over")), s.get("winner"), s.get("resigned")
        self.win_cells = []
        if self.over and self.winner and not self.resigned and moves:
            self.win_cells = self.board.win_line(moves[-1][0], moves[-1][1], self.winner)
        if not self.over:
            self.result = None
        self.refresh()
        if self.over and not was_over:
            gid = self.game_id
            self.root.after(700, lambda: gid == self.game_id and self.open_result())

    def poll_net(self):
        if not self.alive:
            return
        while not self.net_queue.empty():
            kind, conn, data = self.net_queue.get()
            if kind == "error":
                if getattr(self, "reconnect_until", 0):  # 다시 접속 중: 조용히 다음 시도
                    self.root.after(2000, self.try_reconnect)
                    continue
                self.net_text = data
                self.refresh()
                messagebox.showerror("네트워크", data)
            elif kind == "incoming":  # 방장: 새 연결 -> 'join'으로 플레이어/관전을 밝힐 때까지 대기
                if self.server is None:
                    conn.close()
                    continue
                self.pending.add(conn)
                threading.Thread(target=self._reader, args=(conn,), daemon=True).start()
            elif kind == "connected":  # 참가자/관전자: 방장에게 연결됨
                self.conn = conn
                self.reconnect_until = 0
                self.mode = "net"
                self.net_ready = False
                threading.Thread(target=self._reader, args=(conn,), daemon=True).start()
                self.send({"type": "join", "role": "spectator" if getattr(self, "want_spectate", False) else "player",
                           "name": self.nick, "avatar": self.my_avatar})
                self.net_text = "연결됨 - 방장 응답 대기..."
                self.refresh()
            elif conn in self.pending:
                self.on_join(conn, data if kind == "msg" else None)
            elif any(x["conn"] is conn for x in self.specs):
                self.on_spec_msg(conn, kind, data)
            elif conn is not self.conn:
                continue
            elif kind == "closed":
                self.conn = None
                in_game = self.net_ready and not self.over and not self.spectating
                if in_game and self.server is None:  # 참가자: 다시 접속해서 이어 하기
                    self.net_text = "연결이 끊겼어요 · 다시 접속하는 중..."
                    self.net_ready = False
                    self.refresh()
                    self.start_reconnect()
                    continue
                if in_game and self.server is not None:  # 방장: 같은 사람이 돌아오길 기다림
                    self.waiting_back = self.opp_name
                    self.net_ready = False
                    self.net_text = "상대 연결이 끊겼어요 · 다시 들어오길 기다리는 중..."
                    self.note(f"{self.opp_name or '상대'}님 연결이 끊겼어요 (다시 들어오면 이어서 해요)")
                    self.refresh()
                    continue
                self.net_ready = False
                self.net_text = "상대와 연결이 끊어졌습니다"
                self.refresh()
                messagebox.showwarning("네트워크", "상대와 연결이 끊어졌습니다.")
            else:
                self.on_net_msg(data)
        self.root.after(100, self.poll_net)

    def on_net_msg(self, data):
        t = data.get("type")
        if t == "snapshot":
            self.apply_snapshot(data)
            return
        if t == "specs":
            self.spec_count = int(data.get("n", 0))
            self.spec_names = ui_kit.clean_names(data.get("names"))
            self.refresh()
            return
        if t == "resume":
            self.resume_from(data)
            return
        if t == "start":
            self.spectating = False
            self.player = WHITE if data.get("color") == WHITE else BLACK
            self.opp_name = str(data.get("name", ""))[:12] or None
            self.opp_avatar = avatars.valid(data.get("avatar")) if avatars else None
            self.rule_var.set(data.get("rule") if data.get("rule") in RULES else "33")
            self.net_ready = True
            self.send({"type": "hello", "name": self.nick, "avatar": self.my_avatar})
            self.reset_board()
        elif t == "hello":
            self.opp_name = str(data.get("name", ""))[:12] or None
            self.opp_avatar = avatars.valid(data.get("avatar")) if avatars else None
            self.refresh()
        elif t == "new":
            rule = data.get("rule") if data.get("rule") in RULES else self.board.rule
            self.rule_var.set(rule)
            self.reset_board(rule)
        elif t == "undo_req":
            self.on_undo_req(data.get("n"))
        elif t in ("undo_ok", "undo_no"):
            self.on_undo_answer(t == "undo_ok")
        elif t == "move":
            r, c = data.get("r"), data.get("c")
            if isinstance(r, int) and isinstance(c, int) and self.board.turn != self.player:
                self.play(r, c, remote=True)
        elif t == "chat" and self.chat_panel:
            name = str(data.get("name") or self.opp_name or "상대")[:12]
            text = str(data.get("text", ""))[:chat.MAX_TEXT]
            self.chat_panel.add(name, text, "#3DDC97")
            self.send_specs({"type": "chat", "name": name, "text": text})
        elif t == "sticker" and chat and data.get("id") in chat.STICKER_IDS:
            name = str(data.get("name") or self.opp_name or "상대")[:12]
            self.show_sticker(data["id"], name)
            self.send_specs({"type": "sticker", "id": data["id"], "name": name})
        elif t == "emote":
            self.apply_emote(data.get("color"), data.get("text"), bool(data.get("teabag")))
            self.send_specs(data)
        elif t == "resign":
            self.do_resign(data.get("color"), notify=False)

    def on_join(self, conn, data):
        """방장: 새로 들어온 연결이 플레이어인지 관전자인지 정함."""
        self.pending.discard(conn)
        if not data or data.get("type") != "join":
            return
        name = str(data.get("name", "손님"))[:12]
        av = avatars.valid(data.get("avatar")) if avatars else None
        if data.get("role") == "player" and self.conn is None and getattr(self, "waiting_back", None) == name \
                and not self.over:  # 끊겼던 상대가 돌아옴: 지금까지의 판을 그대로 보내 줌
            self.conn, self.net_ready, self.waiting_back = conn, True, None
            self.opp_avatar = av or self.opp_avatar
            self.send({"type": "resume", "color": other(self.player), "rule": self.board.rule, "name": self.nick,
                       "avatar": self.my_avatar, "moves": [list(m) for m in self.board.moves],
                       "undos": {str(k): v for k, v in self.undos_left.items()}})
            self.note(f"{name}님이 다시 들어왔어요!")
            sfx("join")
            self.refresh()
            return
        if data.get("role") == "player" and self.conn is None:
            self.conn = conn
            self.net_ready = True
            self.opp_name, self.opp_avatar = name, av
            self.player = BLACK if self.color_var.get() == "b" else WHITE
            self.send({"type": "start", "color": other(self.player), "rule": self.rule_var.get(),
                       "name": self.nick, "avatar": self.my_avatar})
            self.reset_board()
            if self.specs:
                self.send(self.specs_msg())
            return
        self.specs.append({"conn": conn, "name": name})  # 이미 대전 중이면 관전
        self.send_to(conn, self.snapshot())
        self.spec_changed(f"{name}님이 관전을 시작했어요")

    def on_spec_msg(self, conn, kind, data):
        spec = next(x for x in self.specs if x["conn"] is conn)
        if kind == "closed":
            self.specs.remove(spec)
            self.spec_changed(f"{spec['name']}님이 관전을 그만뒀어요")
            return
        t = data.get("type")
        if t == "chat" and self.chat_panel:
            text = str(data.get("text", ""))[:chat.MAX_TEXT]
            self.chat_panel.add(f"{spec['name']}(관전)", text, MUTED)
            msg = {"type": "chat", "name": f"{spec['name']}(관전)", "text": text}
        elif t == "sticker" and chat and data.get("id") in chat.STICKER_IDS:
            self.show_sticker(data["id"], f"{spec['name']}(관전)")
            msg = {"type": "sticker", "id": data["id"], "name": f"{spec['name']}(관전)"}
        else:
            return
        self.send(msg)
        self.send_specs(msg, exclude=conn)

    def spec_changed(self, note):
        if self.chat_panel:
            self.chat_panel.add("", note, system=True)
        self.send(self.specs_msg())
        self.send_specs(self.specs_msg())
        self.refresh()

    def close_net(self):
        for s in [self.conn, self.server] + [x["conn"] for x in self.specs] + list(self.pending):
            if s:
                try:
                    s.close()
                except OSError:
                    pass
        self.conn = self.server = None
        self.net_ready = False
        self.specs, self.pending = [], set()

    def shutdown(self):
        """미니게임룸에서 화면을 떠날 때: 반복 작업과 연결을 정리."""
        self.alive = False
        self.close_net()

    def on_close(self):
        self.shutdown()
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
    OmokApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
