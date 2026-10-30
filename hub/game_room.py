"""KI득KI득: 첫 화면에서 닉네임을 정하고 게임(체스/야추/오목)과 모드를 골라 시작

실행: python hub/game_room.py
(chess/chess_game.py, yacht/yacht_game.py, omok/omok_game.py 를 불러와 사용)
"""
import json
import math
import os
import sys
import threading
import time
import tkinter as tk
import tkinter.font as tkfont
from tkinter import filedialog, messagebox

HERE = os.path.dirname(os.path.abspath(__file__))
for sub in (".", "..", os.path.join("..", "chess"), os.path.join("..", "yacht"), os.path.join("..", "omok")):
    sys.path.insert(0, os.path.normpath(os.path.join(HERE, sub)))

import avatars  # noqa: E402
import lan  # noqa: E402  (같은 와이파이 방 목록 / 우리 반 랭킹)
import sound  # noqa: E402
import ui_kit  # noqa: E402
import chess_game  # noqa: E402
import omok_game  # noqa: E402
import yacht_game  # noqa: E402

BG = yacht_game.BG
PANEL = yacht_game.PANEL
CARD = yacht_game.CARD
TEXT = yacht_game.TEXT
MUTED = yacht_game.MUTED
ACCENT = yacht_game.ACCENT
DANGER = yacht_game.DANGER
PINK = "#FF5C8A"
MINT = "#3DDC97"
UI_FONT = yacht_game.UI_FONT
NUM_FONT = yacht_game.NUM_FONT
BOLD = "bold"
blend = yacht_game.blend

SETTINGS_FILE = os.path.join(os.path.expanduser("~"), ".mini_game_room.json")
APP_NAME = "KI득KI득"
APP_VERSION = "1.1.0"
UPDATE_URL = "https://raw.githubusercontent.com/devtaego/PJ_KDKD/main/VERSION"  # 새 버전 알림용
DOWNLOAD_URL = "https://github.com/devtaego/PJ_KDKD/tree/main/release"
LEVELS = [("easy", "쉬움"), ("normal", "보통"), ("hard", "어려움")]
RULES_TEXT = {
    "chess": ["두 사람이 백과 흑을 나눠 갖고 백부터 번갈아 한 수씩 둬요.",
              "기물을 누르면 갈 수 있는 칸이 표시돼요. 상대 킹을 피할 수 없게 공격(체크메이트)하면 승리!",
              "킹: 사방 한 칸 · 퀸: 직선/대각선 끝까지 · 룩: 직선 · 비숍: 대각선 · 나이트: L자로 점프 · 폰: 앞으로 한 칸 (처음엔 두 칸), 잡을 땐 대각선",
              "캐슬링, 앙파상, 승진(끝 줄에 닿은 폰은 퀸 등으로)도 지원해요.",
              "시간 모드에서는 내 시계가 0이 되면 져요. 무르기는 컴퓨터 대전만 무제한, 사람끼리는 한 판에 2번."],
    "yacht": ["주사위 5개로 족보를 만들어 점수표 12칸을 채우고, 총점이 가장 높은 사람이 이겨요.",
              "내 차례에 최대 3번 던질 수 있어요. 오른쪽 컵을 꾹 눌러 흔들다 놓으면 던져요.",
              "남기고 싶은 주사위를 누르면 위 칸에 고정돼요. 다시 던지면 나머지만 굴러가요.",
              "점수표의 회색 숫자를 누르면 그 칸에 기록하고 차례가 넘어가요. 0점이라도 한 칸은 꼭 채워야 해요.",
              "에이스~식스 합이 63점 이상이면 보너스 +35점! 항목 이름에 마우스를 올리면 설명이 나와요."],
    "omok": ["흑부터 번갈아 돌을 놓고, 가로·세로·대각선으로 정확히 5개를 먼저 이으면 승리!",
             "6개 이상 이어진 장목은 승리로 치지 않아요.",
             "쌍삼 금지 룰: 한 수로 열린 3이 두 개 생기는 자리에는 둘 수 없어요 (자유룰은 제한 없음).",
             "마지막에 놓은 돌에는 빨간 점이 찍혀요. 무르기는 컴퓨터 대전만 무제한, 사람끼리는 한 판에 2번."],
}
APP_SUB = "같은 기수, 키득키득"
DEVELOPER = "KDA 5기 송재혁"
ROOM_ADJ = ["용감한", "졸린", "신나는", "수줍은", "배고픈", "반짝이는", "느긋한", "씩씩한", "엉뚱한", "다정한"]
ROOM_ANIMAL = ["판다", "여우", "토끼", "곰돌이", "병아리", "개구리", "고양이", "돼지", "펭귄", "다람쥐"]
CREDITS = [  # 앱 안에 표시하는 오픈소스 목록
    ("Python", "PSF License", "프로그램 언어"),
    ("Tcl/Tk (tkinter)", "BSD 스타일 라이선스", "화면"),
    ("Pillow", "MIT-CMU (HPND)", "기물·돌·사진 그리기"),
    ("PyInstaller", "GPL 2.0 + 배포 예외", "exe 만들기"),
    ("주아체 (Jua)", "SIL OFL 1.1", "글꼴 (fonts/Jua-OFL.txt)"),
]
# 첫 화면 배경 장식: (가로 비율, 세로 비율, 종류, 값, 크기, 기울기)
DECOR = [  # 카드와 겹치지 않게 양쪽 가장자리에만
    (0.05, 0.20, "die", 6, 34, -0.35), (0.04, 0.42, "stone", "b", 28, 0), (0.042, 0.62, "piece", "N", 38, 0),
    (0.045, 0.82, "die", 3, 28, 0.4), (0.95, 0.22, "piece", "Q", 36, 0), (0.958, 0.44, "die", 5, 30, 0.3),
    (0.96, 0.63, "stone", "w", 28, 0), (0.955, 0.82, "die", 1, 26, -0.2),
]
GAMES = {
    "chess": {"title": "체스", "color": "#6D4BFF", "tags": ["1:1", "컴퓨터", "네트워크"],
              "desc": "클래식 체스 · 시간 모드 · 방장 사기 모드",
              "modes": [("ai", "컴퓨터 대전"), ("pvp", "한 PC 2인"), ("net", "네트워크")]},
    "yacht": {"title": "야추 다이스", "color": PINK, "tags": ["2~6명", "컴퓨터", "네트워크"],
              "desc": "주사위 5개로 족보 만들기 · 최대 6명",
              "modes": [("ai", "컴퓨터 대전"), ("local", "한 PC 여럿이"), ("net", "네트워크")]},
    "omok": {"title": "오목", "color": "#E0952E", "tags": ["1:1", "컴퓨터", "네트워크"],
             "desc": "15줄 오목 · 쌍삼 금지 / 자유룰",
             "modes": [("ai", "컴퓨터 대전"), ("pvp", "한 PC 2인"), ("net", "네트워크")]},
}
DEFAULTS = {
    "chess": {"mode": "ai", "color": "w", "time": "unlimited", "op": False, "net": "host"},
    "yacht": {"mode": "ai", "count": 2, "net": "host"},
    "omok": {"mode": "ai", "color": "b", "rule": "33", "net": "host"},
}
for _d in DEFAULTS.values():
    _d["level"] = "normal"


def load_settings():
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    for game, d in DEFAULTS.items():
        data[game] = {**d, **data.get(game, {})}
    data["avatar"] = avatars.valid(data.get("avatar")) or avatars.default_avatar()
    return data


def round_rect(cv, x0, y0, x1, y1, r, **kw):
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    pts = [x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r, x1, y1 - r, x1, y1,
           x1 - r, y1, x0 + r, y1, x0, y1, x0, y1 - r, x0, y0 + r, x0, y0]
    return cv.create_polygon(pts, smooth=True, **kw)


class GameRoom:
    def __init__(self, root):
        self.root = root
        root.title(APP_NAME)
        root.configure(bg=BG)
        sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
        w, h = min(1240, int(sw * 0.92)), min(820, int(sh * 0.86))  # 작은 노트북 화면에서도 잘리지 않게
        root.geometry(f"{w}x{h}+{max((sw - w) // 2, 0)}+{max((sh - h) // 2 - 20, 0)}")
        root.minsize(860, 580)
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.app = None
        # 로딩 화면: 주아체를 불러오는 동안 잠깐 보여 줌
        self.splash = tk.Frame(root, bg=BG)
        self.splash.pack(fill="both", expand=True)
        tk.Label(self.splash, text=APP_NAME, bg=BG, fg="white", font=(NUM_FONT, 30, "bold")).pack(
            expand=True, anchor="s", pady=(0, 8))
        tk.Label(self.splash, text="폰트 준비 중...", bg=BG, fg=MUTED, font=(UI_FONT, 12)).pack(expand=True, anchor="n")
        root.after(400, self._finish_init)

    def _finish_init(self):
        global UI_FONT, NUM_FONT, BOLD
        root = self.root
        UI_FONT, NUM_FONT = yacht_game.setup_fonts(root)
        chess_game.setup_fonts(root)
        omok_game.setup_fonts(root)
        BOLD = yacht_game.BOLD
        self.splash.destroy()

        self.settings = load_settings()
        self.nick_var = tk.StringVar(value=self.settings.get("nick", ""))
        self.nick_var.trace_add("write", self._nick_changed)
        self.ip_var = tk.StringVar(value=self.settings.get("last_ip", ""))
        self.screen, self.game = "home", None
        self.app = self.game_frame = None
        self.images = {}
        self.message = ""

        self.cv = tk.Canvas(root, bg=BG, highlightthickness=0)
        self.cv.pack(fill="both", expand=True)
        self.cv.bind("<Configure>", lambda e: self.redraw())
        self.hits, self.hover, self.pressed = [], None, None
        self.cv.bind("<Motion>", lambda e: self.set_hover(self.hit_at(e.x, e.y)))
        self.cv.bind("<Leave>", lambda e: self.set_hover(None))
        self.cv.bind("<ButtonPress-1>", self.on_press)
        self.cv.bind("<ButtonRelease-1>", self.on_release)
        self.floaters = []
        self.root.after(200, self.float_tick)
        self.nick_entry = tk.Entry(self.cv, textvariable=self.nick_var, font=(UI_FONT, 15, BOLD), relief="flat",
                                   bd=0, bg=CARD, fg=TEXT, insertbackground=TEXT, justify="center")
        self.ip_entry = tk.Entry(self.cv, textvariable=self.ip_var, font=(yacht_game.MONO_FONT, 14), relief="flat",
                                 bd=0, bg=CARD, fg=TEXT, insertbackground=TEXT, justify="center")
        self.ip_entry.bind("<Return>", lambda e: self.start())
        self.room_var = tk.StringVar()
        self.room_entry = tk.Entry(self.cv, textvariable=self.room_var, relief="flat", bd=0, bg=CARD, fg=TEXT,
                                   insertbackground=TEXT, justify="center")
        self.room_entry.bind("<Return>", lambda e: self.start())
        self.k = 1.0
        self.intro_var = tk.StringVar(value=self.settings.get("intro", ""))
        self.intro_var.trace_add("write", self._intro_changed)
        self.intro_entry = tk.Entry(self.cv, textvariable=self.intro_var, relief="flat", bd=0, bg=CARD, fg=TEXT,
                                    insertbackground=TEXT, justify="center")
        self.rank_scope = "pc"  # 랭킹: 이 PC / 우리 반
        self.room_beacon = None
        self.new_version = None
        self.lan_sig = None
        sound.enabled = self.settings.get("sound", True)
        lan.start()
        self.me_beacon = lan.Beacon(self.who_msg, every=2.0)
        threading.Thread(target=self.check_update, daemon=True).start()
        self.root.after(1500, self.lan_tick)

    # ---- 같은 와이파이: 내 소식 알리기 / 방 목록 새로고침
    def who_msg(self):
        nick = self.settings.get("nick", "")
        if not nick:
            return None
        recs = {g: r for g, rs in self.settings.get("records", {}).items() for n, r in rs.items() if n == nick}
        return {"kind": "who", "name": nick, "intro": self.settings.get("intro", ""), "records": recs}

    def room_msg(self):
        """내가 방장인 방을 같은 와이파이에 알림 (게임마다 상태를 읽어서)."""
        app, game = self.app, self.game
        if app is None or not getattr(app, "alive", False):
            return None
        if game in ("chess", "omok"):
            if getattr(app, "server", None) is None:
                return None
            info = {"players": 2 if app.conn else 1, "max": 2, "specs": len(app.specs),
                    "playing": bool(app.conn and app.net_ready)}
        else:
            if getattr(app, "role", None) != "host":
                return None
            info = {"players": len(app.guests) + 1, "max": yacht_game.MAX_PLAYERS, "specs": len(app.specs),
                    "playing": bool(app.started)}
        return {"kind": "room", "game": game, "host": self.nick_var.get().strip() or "방장", **info}

    def lan_tick(self):
        """1.5초마다: 친구들 한 줄 소개 반영, 방 목록이 바뀌었으면 다시 그림."""
        try:
            people = lan.people()
            ui_kit.INTROS.clear()
            ui_kit.INTROS.update({n: p["intro"] for n, p in people.items() if p.get("intro")})
            if self.nick_var.get().strip() and self.intro_var.get().strip():
                ui_kit.INTROS[self.nick_var.get().strip()] = self.intro_var.get().strip()
            if self.app is None:
                sig = None
                if self.screen == "menu" and self.settings[self.game]["mode"] == "net" and \
                        self.settings[self.game]["net"] in ("join", "watch"):
                    sig = repr([(r["ip"], r["host"], r["players"], r["playing"]) for r in lan.rooms(self.game)])
                elif self.screen == "rank" and self.rank_scope == "class":
                    sig = repr(sorted((n, repr(p["records"])) for n, p in people.items()))
                elif self.screen == "home":
                    sig = self.new_version
                if sig != self.lan_sig:
                    self.lan_sig = sig
                    self.redraw()
        finally:
            self.root.after(1500, self.lan_tick)

    def check_update(self):
        """GitHub의 VERSION 파일과 비교해서 새 버전이 있으면 첫 화면에 알림 (실패하면 조용히)."""
        try:
            import urllib.request
            with urllib.request.urlopen(UPDATE_URL, timeout=4) as r:
                latest = r.read(32).decode("utf-8").strip()
            parse = lambda v: tuple(int(x) for x in v.split("."))  # noqa: E731
            if parse(latest) > parse(APP_VERSION):
                self.new_version = latest
        except Exception:
            pass

    def open_download(self):
        import webbrowser
        webbrowser.open(DOWNLOAD_URL)

    def toggle_sound(self):
        sound.enabled = not sound.enabled
        self.settings["sound"] = sound.enabled
        self.save()
        sound.play("click")
        self.redraw()

    def _intro_changed(self, *_):
        v = self.intro_var.get()
        if len(v) > 20:
            self.intro_var.set(v[:20])
            return
        self.settings["intro"] = v.strip()
        self.save()

    # ---- 설정 저장
    def _nick_changed(self, *_):
        v = self.nick_var.get()
        if len(v) > 12:
            self.nick_var.set(v[:12])
            return
        self.save()
        if self.message and v.strip() and self.screen == "home":
            self.message = ""
            self.redraw()

    def save(self):
        self.settings["nick"] = self.nick_var.get().strip()
        self.settings["last_ip"] = self.ip_var.get().strip()
        try:
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.settings, f, ensure_ascii=False)
        except OSError:
            pass

    # ---- 공통 그리기
    def redraw(self):
        cv = self.cv
        cv.delete("all")
        self.btn_seq = 0
        self.hits, self.hover = [], None
        w, h = cv.winfo_width(), cv.winfo_height()
        if w < 10:
            return
        self.k = min(max(min(w / 1240, h / 820), 0.7), 1.6)  # 화면 크기 비율
        self.draw_background(w, h)
        if self.screen == "home":
            self.draw_home(w, h)
        elif self.screen == "rank":
            self.draw_rank(w, h)
        elif self.screen == "info":
            self.draw_info(w, h)
        elif self.screen == "rules":
            self.draw_rules(w, h)
        else:
            self.draw_menu(w, h)

    BG_STOPS = ("#1A1446", "#2B1A5E", "#3E1D5C")

    def bg_at(self, y, h):
        t = min(max(y / max(h, 1), 0), 1)
        a, b, c = self.BG_STOPS
        return blend(a, b, t * 2) if t < 0.5 else blend(b, c, (t - 0.5) * 2)

    def draw_background(self, w, h):
        cv = self.cv
        step = 4
        for y in range(0, h, step):  # 남색 -> 보라 -> 자주 3색 그라데이션
            cv.create_rectangle(0, y, w, y + step, fill=self.bg_at(y, h), width=0)
        blobs = ((w * 0.08, h * 0.12, 300, ACCENT, 0.22), (w * 0.95, h * 0.9, 340, PINK, 0.2),
                 (w * 0.88, h * 0.08, 200, MINT, 0.12), (w * 0.15, h * 0.95, 220, "#FFB547", 0.12),
                 (w * 0.5, h * 0.55, 420, "#5B3DF5", 0.08))
        for cx, cy, rad, col, strength in blobs:  # 색깔별 빛 번짐
            for k in range(16, 0, -1):
                r = rad * k / 16
                cv.create_oval(cx - r, cy - r, cx + r, cy + r, width=0,
                               fill=blend(self.bg_at(cy, h), col, strength * (1 - k / 16) + 0.015))
        gap = 34
        for y in range(gap // 2, h, gap):  # 은은한 점무늬
            dot = blend(self.bg_at(y, h), "#FFFFFF", 0.06)
            for x in range(gap // 2 + (gap // 2 if (y // gap) % 2 else 0), w, gap):
                cv.create_oval(x - 1.3, y - 1.3, x + 1.3, y + 1.3, fill=dot, width=0)
        rnd = __import__("random").Random(11)
        for _ in range(22):  # 반짝이
            x, y = rnd.uniform(0, w), rnd.uniform(0, h)
            r = rnd.uniform(3, 7)
            col = blend(self.bg_at(y, h), rnd.choice(["#FFFFFF", MINT, "#FFC94D", PINK]), rnd.uniform(0.35, 0.7))
            cv.create_polygon(x, y - r, x + r * 0.28, y - r * 0.28, x + r, y, x + r * 0.28, y + r * 0.28, x, y + r,
                              x - r * 0.28, y + r * 0.28, x - r, y, x - r * 0.28, y - r * 0.28, fill=col, outline="")
        self.floaters = []
        if self.screen in ("home", "menu", "info"):  # 가장자리에 떠다니는 게임 아이콘
            for k, (fx, fy, kind, val, size, ang) in enumerate(DECOR):
                tag = f"float{k}"
                x, y = fx * w, fy * h
                size = int(size * self.k)
                if kind == "die":
                    yacht_game.draw_die(cv, x, y, size, val, angle=ang, tags=tag, shadow=blend(self.bg_at(y, h),
                                                                                            "#000000", 0.35))
                elif kind == "stone":
                    img = self.stone_image(val, size)
                    if img:
                        cv.create_image(x, y, image=img, tags=tag)
                else:
                    img = self.piece_image(val, "w" if k % 2 else "b", size)
                    if img:
                        cv.create_image(x, y, image=img, tags=tag)
                self.floaters.append({"tag": tag, "amp": 5 + k % 3 * 2, "speed": 0.9 + k * 0.13, "phase": k * 1.7,
                                      "dy": 0.0})

    def float_tick(self):
        """배경 아이콘이 천천히 둥실둥실."""
        if self.app is None and getattr(self, "floaters", None):
            t = time.monotonic()
            for f in self.floaters:
                dy = math.sin(t * f["speed"] + f["phase"]) * f["amp"]
                self.cv.move(f["tag"], 0, dy - f["dy"])
                f["dy"] = dy
        self.root.after(50, self.float_tick)

    # ---- 버튼 영역: 그릴 때 등록해 두고 마우스 좌표로 판정
    def add_hit(self, box, command, enter=None, leave=None):
        self.hits.append({"box": box, "cmd": command, "enter": enter, "leave": leave})

    def hit_at(self, x, y):
        for h in reversed(self.hits):  # 나중에 그린 것이 위
            x0, y0, x1, y1 = h["box"]
            if x0 <= x <= x1 and y0 <= y <= y1:
                return h
        return None

    def set_hover(self, h):
        if h is self.hover:
            return
        old, self.hover = self.hover, h
        if old and old["leave"]:
            old["leave"]()
        if h and h["enter"]:
            h["enter"]()
        self.cv.config(cursor="hand2" if h else "")

    def on_press(self, e):
        self.pressed = self.hit_at(e.x, e.y)

    def on_release(self, e):
        h = self.hit_at(e.x, e.y)
        pressed, self.pressed = self.pressed, None
        if h is not None and h is pressed:
            sound.play("click")
            h["cmd"]()

    # ---- 화면 크기 적응: 기준(1240x820) 대비 비율 k를 글자·버튼·간격에 곱함
    def S(self, v):
        return v * self.k

    def F(self, size, bold=True, num=False):
        return (NUM_FONT if num else UI_FONT, max(int(round(size * self.k)), 7), BOLD if bold else "normal")

    def pill(self, x0, y0, x1, y1, text, command, bg=CARD, fg=TEXT, size=11, selected=False, radius=None):
        fill = ACCENT if selected else bg
        rect = round_rect(self.cv, x0, y0, x1, y1, radius or (y1 - y0) / 2, fill=fill, outline="")
        self.cv.create_text((x0 + x1) / 2, (y0 + y1) / 2, text=text, fill="white" if selected else fg,
                            font=self.F(size))
        hover = blend(fill, "#FFFFFF", 0.14)
        self.add_hit((x0, y0, x1, y1), command, lambda: self.cv.itemconfig(rect, fill=hover),
                     lambda: self.cv.itemconfig(rect, fill=fill))

    def draw_title(self, cx, cy, size):
        """KI득KI득 - KI는 색으로, 득은 흰색으로."""
        parts = [("KI", "#A994FF"), ("득", "white"), ("KI", "#FF8FB1"), ("득", "white")]
        font = self.F(size, num=True)
        measure = tkfont.Font(family=font[0], size=font[1], weight=font[2])
        widths = [measure.measure(t) for t, _ in parts]
        x = cx - sum(widths) / 2
        for (t, col), wd in zip(parts, widths):
            self.cv.create_text(x + self.S(3), cy + self.S(4), text=t, anchor="w", fill="#120E2A", font=font)
            self.cv.create_text(x, cy, text=t, anchor="w", fill=col, font=font)
            x += wd

    def piece_image(self, kind, color, size):
        size = max(int(size), 8)
        key = ("p", kind, color, size)
        if key not in self.images and chess_game.Image is not None:
            self.images[key] = chess_game.ImageTk.PhotoImage(chess_game.render_piece(kind, color, size))
        return self.images.get(key)

    def draw_icon(self, game, cx, cy, s, tags=()):
        cv = self.cv
        if game == "chess":
            for kind, color, dx, size in (("K", "b", 0.22, 0.95), ("N", "w", -0.18, 1.1)):
                img = self.piece_image(kind, color, int(s * size))
                if img:
                    cv.create_image(cx + dx * s, cy, image=img, tags=tags)
                else:
                    chess_game.draw_piece(cv, kind, color, cx + dx * s, cy, s * size, tags)
        elif game == "omok":
            half = s * 0.62
            round_rect(cv, cx - half + s * 0.04, cy - half * 0.8 + s * 0.08, cx + half + s * 0.04,
                       cy + half * 0.8 + s * 0.08, s * 0.1, fill="#5A3412", outline="", tags=tags)
            round_rect(cv, cx - half, cy - half * 0.8, cx + half, cy + half * 0.8, s * 0.1, fill="#E3B36E",
                       outline="#B98546", width=2, tags=tags)
            n = 5
            gx, gy = half * 2 / (n + 1), half * 1.6 / (n + 1)
            for i in range(1, n + 1):
                cv.create_line(cx - half + gx, cy - half * 0.8 + gy * i, cx + half - gx, cy - half * 0.8 + gy * i,
                               fill="#5B3A1A", tags=tags)
                cv.create_line(cx - half + gx * i, cy - half * 0.8 + gy, cx - half + gx * i, cy + half * 0.8 - gy,
                               fill="#5B3A1A", tags=tags)
            for gc, gr, col in ((2, 2, "b"), (3, 3, "w"), (3, 2, "b"), (4, 4, "w"), (4, 1, "b")):
                x, y = cx - half + gx * gc, cy - half * 0.8 + gy * gr
                img = self.stone_image(col, int(gx * 0.95))
                if img:
                    cv.create_image(x, y, image=img, tags=tags)
                else:
                    r = gx * 0.42
                    cv.create_oval(x - r, y - r, x + r, y + r, fill="#111" if col == "b" else "#F5F2EA", tags=tags)
        else:
            for dx, dy, face, ang in ((-0.42, 0.12, 6, -0.3), (0.0, -0.1, 5, 0.12), (0.42, 0.14, 1, 0.35)):
                yacht_game.draw_die(cv, cx + dx * s, cy + dy * s, s * 0.42, face, angle=ang, tags=tags)

    def stone_image(self, col, size):
        size = max(int(size), 6)
        key = ("stone", col, size)
        if key not in self.images and omok_game.Image is not None:
            color = omok_game.BLACK if col == "b" else omok_game.WHITE
            self.images[key] = omok_game.ImageTk.PhotoImage(omok_game.render_stone(color, size))
        return self.images.get(key)

    # ---- 첫 화면
    def draw_home(self, w, h):
        cv, S = self.cv, self.S
        cx = w / 2
        top = max((h - S(820)) / 2, 0)  # 아주 넓은 창이면 가운데로
        cv.create_text(cx, top + S(60), text=APP_SUB, fill=MINT, font=self.F(13))
        self.draw_title(cx, top + S(108), 46)

        # 닉네임
        ny = top + S(178)
        nx, ix = cx - S(150), cx + S(150)  # 왼쪽 닉네임, 오른쪽 한 줄 소개
        bad = self.message and not self.nick_var.get().strip()
        cv.create_text(nx, ny, text=self.message if bad else "닉네임", fill=DANGER if bad else MUTED,
                       font=self.F(10))
        round_rect(cv, nx - S(140), ny + S(16), nx + S(140), ny + S(66), S(25), fill=CARD,
                   outline=DANGER if bad else blend(CARD, "#FFFFFF", 0.15), width=2)
        self.nick_entry.config(font=self.F(15))
        cv.create_window(nx, ny + S(41), window=self.nick_entry, width=S(230), height=S(34))
        cv.create_text(ix, ny, text="한 줄 소개 (선택 · MBTI, 관심사...)", fill=MUTED, font=self.F(10))
        round_rect(cv, ix - S(140), ny + S(16), ix + S(140), ny + S(66), S(25), fill=CARD,
                   outline=blend(CARD, "#FFFFFF", 0.15), width=2)
        self.intro_entry.config(font=self.F(12))
        cv.create_window(ix, ny + S(41), window=self.intro_entry, width=S(240), height=S(30))

        self.draw_avatar_picker(cx, ny + S(124))

        # 게임 카드
        ctop = ny + S(180)
        n = len(GAMES)
        gap = S(28)
        cw = min(S(320), (w - S(100) - gap * (n - 1)) / n)
        ch = min(S(340), h - ctop - S(60))
        for i, game in enumerate(GAMES):
            x0 = cx - (n * cw + (n - 1) * gap) / 2 + i * (cw + gap)
            self.draw_card(game, x0, ctop, cw, ch)

        self.pill(w - S(144), S(22), w - S(24), S(60), "★  랭킹", self.open_rank, bg=CARD, size=11)
        self.pill(w - S(254), S(22), w - S(154), S(60), "소리 켬" if sound.enabled else "소리 끔", self.toggle_sound,
                  bg=CARD if sound.enabled else blend(CARD, "#000000", 0.3), fg=TEXT if sound.enabled else MUTED,
                  size=10)
        if self.new_version:  # 새 버전 알림
            self.pill(S(24), S(22), S(234), S(60), f"새 버전 {self.new_version} 받기 ▶", self.open_download, bg=MINT,
                      fg=BG, size=10)
        cv.create_text(S(24), h - S(26), anchor="w",
                       text=f"내 IP  {chess_game.local_ip()}   ·   네트워크 대전은 같은 와이파이(또는 핫스팟)에서",
                       fill=MUTED, font=self.F(9, bold=False))
        cv.create_text(w - S(112), h - S(26), anchor="e", text=f"Made by  {DEVELOPER}", fill="#D9D4F5",
                       font=self.F(10))
        self.pill(w - S(100), h - S(42), w - S(24), h - S(10), "정보", self.open_info, bg=CARD, size=9)

    def draw_avatar_picker(self, cx, cy):
        cv, S = self.cv, self.S
        cur = self.settings["avatar"]
        options = [{"type": "animal", "id": a[0]} for a in avatars.ANIMALS]
        photo = cur if cur["type"] == "photo" else None
        size, gap = S(46), S(12)
        n = len(options) + 1
        x = cx - (n * size + (n - 1) * gap) / 2 + size / 2
        cv.create_text(cx, cy - size / 2 - S(14), text="프로필", fill=MUTED, font=self.F(10))
        for spec in options + [photo or "photo"]:
            chosen = spec == cur
            if spec == "photo":  # 아직 사진이 없을 때: '+ 사진' 버튼
                cv.create_oval(x - size / 2, cy - size / 2, x + size / 2, cy + size / 2, fill=CARD,
                               outline=blend(CARD, "#FFFFFF", 0.25), width=2, dash=(4, 3))
                cv.create_text(x, cy - S(5), text="+", fill=TEXT, font=self.F(14))
                cv.create_text(x, cy + S(11), text="사진", fill=MUTED, font=self.F(8))
                cmd = self.pick_photo
            else:  # 고른 것은 분홍 고리, 마우스를 올리면 흰 고리 (매끈한 이미지로)
                halo = PINK if chosen else None
                item = avatars.draw_avatar(cv, x, cy, size, spec, halo=halo)
                cmd = (lambda sp=spec: self.choose_avatar(sp)) if spec["type"] == "animal" else self.pick_photo
                if item and avatars.Image is not None:
                    on_img = avatars.avatar_image(spec, size, halo=PINK if chosen else "#FFFFFF")
                    off_img = avatars.avatar_image(spec, size, halo=halo)
                    cv.itemconfig(item, image=off_img)
                    self.add_hit((x - size / 2 - S(6), cy - size / 2 - S(6), x + size / 2 + S(6),
                                  cy + size / 2 + S(6)), cmd,
                                 lambda i=item, im=on_img: cv.itemconfig(i, image=im),
                                 lambda i=item, im=off_img: cv.itemconfig(i, image=im))
                    x += size + gap
                    continue
            ring = cv.create_oval(x - size / 2 - S(5), cy - size / 2 - S(5), x + size / 2 + S(5), cy + size / 2 + S(5),
                                  outline=PINK if chosen else "", width=3)
            on = "white" if not chosen else PINK
            self.add_hit((x - size / 2 - S(6), cy - size / 2 - S(6), x + size / 2 + S(6), cy + size / 2 + S(6)), cmd,
                         lambda r=ring, on=on: cv.itemconfig(r, outline=on),
                         lambda r=ring, off=PINK if chosen else "": cv.itemconfig(r, outline=off))
            x += size + gap
        if photo:  # 사진을 고른 뒤에도 다른 사진으로 바꿀 수 있게
            self.pill(x - size / 2, cy - S(14), x - size / 2 + S(74), cy + S(14), "사진 바꾸기", self.pick_photo,
                      bg=CARD, size=9)

    def choose_avatar(self, spec):
        self.settings["avatar"] = spec
        self.save()
        self.redraw()

    def pick_photo(self):
        if avatars.Image is None:
            messagebox.showinfo("프로필", "사진을 쓰려면 Pillow가 필요해요. 동물 캐릭터를 골라 주세요.")
            return
        path = filedialog.askopenfilename(title="프로필 사진 고르기",
                                          filetypes=[("사진", "*.png *.jpg *.jpeg *.gif *.bmp *.webp"), ("모든 파일", "*.*")])
        if not path:
            return
        try:
            self.choose_avatar(avatars.make_photo_spec(path))
        except Exception as e:
            messagebox.showerror("프로필", f"사진을 열 수 없어요: {e}")

    def draw_card(self, game, x0, y0, cw, ch):
        cv, S = self.cv, self.S
        info = GAMES[game]
        col = info["color"]
        round_rect(cv, x0 + S(6), y0 + S(12), x0 + cw + S(6), y0 + ch + S(12), S(28), fill=blend(BG, "#000000", 0.35),
                   outline="")
        body = round_rect(cv, x0, y0, x0 + cw, y0 + ch, S(28), fill=col, outline="", width=3)
        round_rect(cv, x0 + S(14), y0 + S(14), x0 + cw - S(14), y0 + ch * 0.55, S(22), fill=blend(col, "#FFFFFF", 0.18),
                   outline="")
        self.draw_icon(game, x0 + cw / 2, y0 + ch * 0.3, min(cw, ch) * 0.42)
        cv.create_text(x0 + S(26), y0 + ch * 0.64, text=info["title"], anchor="w", fill="white", font=self.F(22))
        cv.create_text(x0 + S(26), y0 + ch * 0.64 + S(32), text=info["desc"], anchor="w",
                       fill=blend(col, "#FFFFFF", 0.8), font=self.F(10, bold=False), width=cw - S(40))
        tag_font = self.F(9)
        measure = tkfont.Font(family=tag_font[0], size=tag_font[1], weight=tag_font[2])
        tx = x0 + S(26)
        for t in info["tags"]:
            tw = measure.measure(t) + S(22)
            round_rect(cv, tx, y0 + ch - S(56), tx + tw, y0 + ch - S(28), S(14), fill=blend(col, "#000000", 0.22),
                       outline="")
            cv.create_text(tx + tw / 2, y0 + ch - S(42), text=t, fill="white", font=tag_font)
            tx += tw + S(8)
        play_font = self.F(11)
        play_w = tkfont.Font(family=play_font[0], size=play_font[1], weight=play_font[2]).measure("PLAY ▶")
        if tx + S(4) < x0 + cw - S(22) - play_w:  # 태그가 길면 PLAY는 생략 (카드 전체가 버튼)
            cv.create_text(x0 + cw - S(22), y0 + ch - S(42), text="PLAY ▶", anchor="e", fill="white", font=play_font)
        self.add_hit((x0, y0, x0 + cw, y0 + ch), lambda: self.open_menu(game),
                     lambda: cv.itemconfig(body, outline="white"), lambda: cv.itemconfig(body, outline=""))

    def open_menu(self, game):
        if not self.nick_var.get().strip():
            self.message = "닉네임을 먼저 입력해 주세요"
            self.redraw()
            self.nick_entry.focus_set()
            return
        self.message = ""
        self.screen, self.game = "menu", game
        self.redraw()

    # ---- 게임별 메뉴
    def menu_rows(self, game, sel):
        info = GAMES[game]
        rows = [("모드", "mode", info["modes"])]
        net = sel["mode"] == "net"
        if net:
            rows.append(("네트워크", "net", [("host", "방 만들기"), ("join", "참가하기"), ("watch", "관전하기")]))
        joining = net and sel["net"] in ("join", "watch")
        if game == "chess" and not joining:
            rows.append(("내 색", "color", [("w", "백 (선공)"), ("b", "흑")]))
            rows.append(("시간", "time", [(k, v[0]) for k, v in chess_game.TIME_MODES.items()]))
        if game == "yacht" and not net:
            rows.append(("인원", "count", [(n, f"{n}명") for n in range(2, 7)]))
        if game == "omok" and not joining:
            rows.append(("내 돌", "color", [("b", "흑 (선공)"), ("w", "백")]))
            rows.append(("룰", "rule", [(k, v[0]) for k, v in omok_game.RULES.items()]))
        if sel["mode"] == "ai":
            rows.append(("컴퓨터 난이도", "level", LEVELS))
        return rows, net, joining

    def draw_menu(self, w, h):
        cv = self.cv
        game = self.game
        info = GAMES[game]
        sel = self.settings[game]
        rows, net, joining = self.menu_rows(game, sel)
        favs = self.settings.get("fav_ips", [])
        found = lan.rooms(game)[:6]
        # 내용 높이(기준 단위)를 먼저 재서, 세로로 넘치면 이 화면만 더 작게
        body = 30 + len(rows) * 74 + 90
        if net:
            body += 70
            if joining:
                body += 66 + (30 + ((len(favs) + 1) // 2) * 44 if favs else 0)
                body += 30 + max((len(found) + 1) // 2, 1) * 44
            elif game == "chess" and chess_game.SHOW_OP:
                body += 54
        self.k = min(self.k, max((h - 20) / (160 + body + 40), 0.55))
        S = self.S
        cx = w / 2
        self.pill(S(24), S(22), S(124), S(60), "←  홈", self.go_home, bg=CARD, size=10)
        round_rect(cv, w - S(244), S(22), w - S(24), S(60), S(19), fill=CARD, outline="")
        avatars.draw_avatar(cv, w - S(224), S(41), S(30), self.settings["avatar"])
        cv.create_text(w - S(202), S(41), text=self.nick_var.get().strip(), anchor="w", fill=TEXT, font=self.F(11))
        self.pill(S(134), S(22), S(244), S(60), "규칙 보기", self.open_rules, bg=CARD, size=10)

        self.draw_icon(game, cx - S(150), S(86), S(90))
        cv.create_text(cx - S(80), S(76), text=info["title"], anchor="w", fill="white", font=self.F(28))
        cv.create_text(cx - S(80), S(112), text=info["desc"], anchor="w", fill=MUTED, font=self.F(10, bold=False))

        pw = min(S(640), w - S(80))
        x0 = cx - pw / 2
        y0 = S(160)
        y1 = y0 + S(body)
        round_rect(cv, x0, y0, x0 + pw, y1, S(30), fill=PANEL, outline="")

        y = y0 + S(28)
        for label, key, options in rows:
            cv.create_text(x0 + S(30), y + S(10), text=label, anchor="w", fill=MUTED, font=self.F(10))
            n = len(options)
            bw = (pw - S(60) - (n - 1) * S(8)) / n
            for i, (value, text) in enumerate(options):
                bx = x0 + S(30) + i * (bw + S(8))
                self.pill(bx, y + S(26), bx + bw, y + S(62), text, lambda k=key, v=value: self.choose(k, v),
                          selected=sel.get(key) == value, size=11)
            y += S(74)

        if net:
            if joining:
                y = self.draw_found_rooms(x0, y, pw, found)
                self.draw_join_fields(x0, y, pw, favs)
                y += S(70) + S(66) + (S(30) + ((len(favs) + 1) // 2) * S(44) if favs else 0)
            else:
                cv.create_text(cx, y + S(30), text=f"내 IP  {chess_game.local_ip()}  을 친구에게 알려 주세요",
                               fill=MINT, font=self.F(12))
                y += S(70)
                if game == "chess" and chess_game.SHOW_OP:
                    on = sel.get("op")
                    self.pill(x0 + S(30), y, x0 + pw - S(30), y + S(38),
                              ("☑" if on else "☐") + "  ★ 방장 사기 모드 (방장 기물 나이트 점프 · 시간 2배)",
                              lambda: self.choose("op", not sel.get("op")),
                              bg=blend(PANEL, PINK, 0.25 if on else 0.08), size=10)
                    y += S(54)

        label = {"host": "방 만들기", "join": "참가하기", "watch": "관전하기"}[sel["net"]] if net else "게임 시작"
        self.pill(x0 + S(30), y + S(14), x0 + pw - S(30), y + S(70), f"{label}  ▶", self.start, bg=PINK, fg="white",
                  size=15)
        if self.message:
            cv.create_text(cx, y1 + S(24), text=self.message, fill=DANGER, font=self.F(10))

    def draw_join_fields(self, x0, y, pw, favs):
        """참가/관전: IP 입력 + 방 이름(선택) + 자주 가는 방."""
        cv, S = self.cv, self.S
        cx = x0 + pw / 2
        cv.create_text(x0 + S(30), y + S(10), text="방장 PC의 IP", anchor="w", fill=MUTED, font=self.F(10))
        round_rect(cv, x0 + S(30), y + S(26), x0 + pw - S(30), y + S(62), S(18), fill=CARD,
                   outline=blend(CARD, "#FFFFFF", 0.15), width=2)
        self.ip_entry.config(font=(yacht_game.MONO_FONT, max(int(14 * self.k), 8)))
        cv.create_window(cx, y + S(44), window=self.ip_entry, width=pw - S(100), height=S(28))
        y += S(70)
        cv.create_text(x0 + S(30), y + S(8), text="방 이름 (선택 · 안 적으면 귀여운 이름으로 저장돼요)", anchor="w",
                       fill=MUTED, font=self.F(9))
        round_rect(cv, x0 + S(30), y + S(22), x0 + pw - S(30), y + S(54), S(16), fill=CARD,
                   outline=blend(CARD, "#FFFFFF", 0.1), width=1)
        self.room_entry.config(font=self.F(11))
        cv.create_window(cx, y + S(38), window=self.room_entry, width=pw - S(100), height=S(26))
        y += S(66)
        if not favs:
            return
        cv.create_text(x0 + S(30), y + S(10), text="자주 가는 방", anchor="w", fill=MUTED, font=self.F(10))
        y += S(26)
        cw = (pw - S(60) - S(10)) / 2
        cur_ip = self.ip_var.get().strip()
        for i, fav in enumerate(favs[:8]):
            r, c = divmod(i, 2)
            bx = x0 + S(30) + c * (cw + S(10))
            by = y + r * S(44)
            chosen = fav["ip"] == cur_ip
            self.pill(bx, by, bx + cw - S(34), by + S(36), f"{fav['name']}  ·  {fav['ip']}",
                      lambda f=fav: self.pick_fav(f), bg=blend(CARD, MINT, 0.18) if chosen else CARD, size=9)
            self.pill(bx + cw - S(30), by + S(4), bx + cw, by + S(32), "✕", lambda f=fav: self.del_fav(f),
                      bg=blend(CARD, DANGER, 0.25), size=9)

    def draw_found_rooms(self, x0, y, pw, found):
        """같은 와이파이에 열린 방: 누르면 IP가 채워짐 (IP를 몰라도 됨)."""
        cv, S = self.cv, self.S
        cv.create_text(x0 + S(30), y + S(10), text="지금 열린 방 (같은 와이파이)", anchor="w", fill=MINT,
                       font=self.F(10))
        y += S(26)
        if not found:
            cv.create_text(x0 + pw / 2, y + S(18), text="찾는 중... 방장이 방을 만들면 여기에 나타나요", fill=MUTED,
                           font=self.F(9, bold=False))
            return y + S(44)
        cw = (pw - S(60) - S(10)) / 2
        cur_ip = self.ip_var.get().strip()
        for i, r in enumerate(found):
            row, col = divmod(i, 2)
            bx = x0 + S(30) + col * (cw + S(10))
            by = y + row * S(44)
            state = "대전 중 · 관전 가능" if r["playing"] else f"{r['players']}/{r['max']}명 · 참가 가능"
            self.pill(bx, by, bx + cw, by + S(36), f"{r['host']}의 방  ·  {state}", lambda r=r: self.pick_room(r),
                      bg=blend(CARD, MINT, 0.25) if r["ip"] == cur_ip else blend(CARD, MINT, 0.08), size=9)
        return y + ((len(found) + 1) // 2) * S(44)

    def pick_room(self, room):
        self.ip_var.set(room["ip"])
        self.room_var.set(f"{room['host']}의 방")
        if room["playing"] and self.settings[self.game]["net"] == "join":
            self.settings[self.game]["net"] = "watch"  # 이미 대전 중이면 관전으로
        self.message = ""
        self.redraw()

    def pick_fav(self, fav):
        self.ip_var.set(fav["ip"])
        self.room_var.set(fav["name"])
        self.message = ""
        self.redraw()

    def del_fav(self, fav):
        self.settings["fav_ips"] = [f for f in self.settings.get("fav_ips", []) if f["ip"] != fav["ip"]]
        self.save()
        self.redraw()

    def remember_ip(self, ip):
        """접속한 IP를 자주 가는 방에 저장 (이름을 안 적으면 귀여운 랜덤 이름)."""
        favs = self.settings.setdefault("fav_ips", [])
        name = self.room_var.get().strip()[:14]
        old = next((f for f in favs if f["ip"] == ip), None)
        if old:
            favs.remove(old)
            name = name or old["name"]
        if not name:
            rnd = __import__("random")
            name = f"{rnd.choice(ROOM_ADJ)} {rnd.choice(ROOM_ANIMAL)} 방"
        favs.insert(0, {"name": name, "ip": ip})
        del favs[8:]
        self.save()

    def choose(self, key, value):
        self.settings[self.game][key] = value
        self.message = ""
        self.save()
        self.redraw()

    # ---- 누적 랭킹 (이 PC에서 한 판들의 기록)
    def record_result(self, game, names, winners):
        """게임이 끝날 때 각 게임이 부름. 이번 참가자들의 누적 우승 횟수를 돌려줌."""
        rec = self.settings.setdefault("records", {}).setdefault(game, {})
        for n in names:
            r = rec.setdefault(n, {"wins": 0, "games": 0})
            r["games"] += 1
            if n in winners:
                r["wins"] += 1
        self.save()
        return {n: rec[n]["wins"] for n in names}

    def class_records(self):
        """우리 반 랭킹: 각자 자기 PC에 있는 '내 기록'만 모음 (같은 판이 두 번 세지지 않게)."""
        out = {}
        nick = self.nick_var.get().strip()
        mine = {g: rs[nick] for g, rs in self.settings.get("records", {}).items() if nick in rs}
        for name, recs in [(nick, mine)] + [(n, p["records"]) for n, p in lan.people().items() if n != nick]:
            for game, r in recs.items():
                if game in GAMES and r.get("games"):
                    out.setdefault(game, {})[name] = {"wins": r["wins"], "games": r["games"]}
        return out

    def open_rank(self):
        self.screen, self.message = "rank", ""
        self.redraw()

    def draw_rank(self, w, h):
        cv, S = self.cv, self.S
        cx = w / 2
        self.pill(S(24), S(22), S(124), S(60), "←  홈", self.go_home, bg=CARD, size=10)
        cv.create_text(cx, S(56), text="랭킹", fill="white", font=self.F(30, num=True))
        for i, (scope, label) in enumerate((("pc", "이 PC"), ("class", "우리 반"))):
            bx = w - S(264) + i * S(122)
            self.pill(bx, S(22), bx + S(112), S(60), label,
                      lambda sc=scope: (setattr(self, "rank_scope", sc), self.redraw()),
                      selected=self.rank_scope == scope, size=10)
        if self.rank_scope == "class":
            records = self.class_records()
            sub = "같은 와이파이에서 KI득KI득을 켠 친구들의 기록이에요 (각자 자기 PC 기록)"
        else:
            records = self.settings.get("records", {})
            sub = "이 PC에서 한 판들의 누적 기록이에요 (우승 많은 순)"
        cv.create_text(cx, S(92), text=sub, fill=MUTED, font=self.F(10))
        n = len(GAMES)
        gap = S(24)
        cw = min(S(400), (w - S(80) - gap * (n - 1)) / n)
        top = S(130)
        name_font = self.F(12)
        measure = tkfont.Font(family=name_font[0], size=name_font[1], weight=name_font[2])
        for i, game in enumerate(GAMES):
            x0 = cx - (n * cw + (n - 1) * gap) / 2 + i * (cw + gap)
            col = GAMES[game]["color"]
            rows = sorted(records.get(game, {}).items(), key=lambda kv: (-kv[1]["wins"], -kv[1]["games"], kv[0]))[:10]
            ch = h - top - S(40)
            round_rect(cv, x0, top, x0 + cw, top + ch, S(24), fill=PANEL, outline="")
            round_rect(cv, x0, top, x0 + cw, top + S(58), S(24), fill=col, outline="")
            cv.create_rectangle(x0, top + S(34), x0 + cw, top + S(58), fill=col, width=0)
            self.draw_icon(game, x0 + S(40), top + S(29), S(40))
            cv.create_text(x0 + S(76), top + S(29), text=GAMES[game]["title"], anchor="w", fill="white",
                           font=self.F(17))
            if not rows:
                cv.create_text(x0 + cw / 2, top + ch / 2, text="아직 기록이 없어요\n한 판 하고 오세요!", fill=MUTED,
                               font=self.F(12), justify="center")
                continue
            row_h = min(S(48), (ch - S(80)) / max(len(rows), 1))
            medal = {0: "#FFC94D", 1: "#D9DDE3", 2: "#E0A36B"}
            for k, (name, r) in enumerate(rows):
                y = top + S(78) + k * row_h
                if k < 3:
                    cv.create_oval(x0 + S(22), y, x0 + S(50), y + S(28), fill=medal[k], outline="")
                cv.create_text(x0 + S(36), y + S(14), text=str(k + 1), fill=BG if k < 3 else MUTED,
                               font=self.F(13, num=True))
                me = name == self.nick_var.get().strip()
                label = name + ("  (나)" if me else "")
                while measure.measure(label) > cw * 0.45 and len(label) > 2:
                    label = label[:-2] + "…"
                cv.create_text(x0 + S(66), y + S(14), text=label, anchor="w", fill=PINK if me else TEXT,
                               font=name_font)
                rate = round(r["wins"] * 100 / r["games"]) if r["games"] else 0
                cv.create_text(x0 + cw - S(20), y + S(14), text=f"{r['wins']}승/{r['games']}판 ({rate}%)", anchor="e",
                               fill=TEXT, font=self.F(11, num=True))

    def open_rules(self):
        self.screen = "rules"
        self.redraw()

    def draw_rules(self, w, h):
        cv = self.cv
        lines = RULES_TEXT[self.game]
        self.k = min(self.k, max((h - 20) / (140 + len(lines) * 74 + 40), 0.55))
        S = self.S
        cx = w / 2
        self.pill(S(24), S(22), S(144), S(60), "←  돌아가기", lambda: (setattr(self, "screen", "menu"), self.redraw()),
                  bg=CARD, size=10)
        self.draw_icon(self.game, cx - S(150), S(70), S(80))
        cv.create_text(cx - S(90), S(70), text=f"{GAMES[self.game]['title']} 규칙", anchor="w", fill="white",
                       font=self.F(26))
        pw = min(S(720), w - S(80))
        x0, y = cx - pw / 2, S(130)
        round_rect(cv, x0, y, x0 + pw, y + S(30 + len(lines) * 74), S(28), fill=PANEL, outline="")
        y += S(24)
        for i, text in enumerate(lines):
            cv.create_oval(x0 + S(26), y + S(4), x0 + S(54), y + S(32), fill=GAMES[self.game]["color"], outline="")
            cv.create_text(x0 + S(40), y + S(18), text=str(i + 1), fill="white", font=self.F(11, num=True))
            cv.create_text(x0 + S(70), y + S(18), text=text, anchor="w", fill=TEXT, font=self.F(11, bold=False),
                           width=pw - S(100))
            y += S(74)

    def open_info(self):
        self.screen, self.message = "info", ""
        self.redraw()

    def draw_info(self, w, h):
        cv = self.cv
        need = 90 + 150 + len(CREDITS) * 52 + 90 + 20
        self.k = min(self.k, max((h - 10) / need, 0.55))
        S = self.S
        cx = w / 2
        self.pill(S(24), S(22), S(124), S(60), "←  홈", self.go_home, bg=CARD, size=10)
        pw = min(S(640), w - S(80))
        x0, y0 = cx - pw / 2, S(90)
        y1 = y0 + S(150 + len(CREDITS) * 52 + 90)
        round_rect(cv, x0, y0, x0 + pw, y1, S(28), fill=PANEL, outline="")
        self.draw_title(cx, y0 + S(40), 26)
        cv.create_text(cx, y0 + S(76), text=f"만든 사람   {DEVELOPER}", fill=PINK, font=self.F(13))
        cv.create_text(cx, y0 + S(104), text=f"{APP_SUB}  ·  체스 · 야추 다이스 · 오목", fill=MUTED,
                       font=self.F(10, bold=False))
        cv.create_text(x0 + S(30), y0 + S(140), anchor="w", text="사용한 오픈소스", fill=TEXT, font=self.F(11))
        y = y0 + S(170)
        for name, lic, what in CREDITS:
            round_rect(cv, x0 + S(24), y - S(20), x0 + pw - S(24), y + S(22), S(14), fill=CARD, outline="")
            cv.create_text(x0 + S(44), y, anchor="w", text=name, fill="white", font=self.F(11))
            cv.create_text(x0 + pw * 0.36, y, anchor="w", text=lic, fill=MINT, font=self.F(10))
            cv.create_text(x0 + pw - S(44), y, anchor="e", text=what, fill=MUTED, font=self.F(9, bold=False))
            y += S(52)
        cv.create_text(cx, y + S(10), text="게임 규칙은 전통 게임 규칙이고, 기물·주사위·캐릭터·스티커는 모두 직접 그렸어요.",
                       fill=MUTED, font=self.F(9, bold=False), width=pw - S(60), justify="center")
        cv.create_text(cx, y + S(36), text="네트워크 대전은 같은 와이파이 안에서만 연결되며, 채팅은 암호화되지 않아요.",
                       fill=MUTED, font=self.F(9, bold=False), width=pw - S(60), justify="center")

    def go_home(self):
        self.screen, self.message = "home", ""
        self.redraw()

    # ---- 게임 시작 / 돌아오기
    def start(self):
        sel = self.settings[self.game]
        nick = self.nick_var.get().strip()
        ip = self.ip_var.get().strip()
        if sel["mode"] == "net" and sel["net"] in ("join", "watch") and not ip:
            self.message = "방장 PC의 IP를 입력해 주세요"
            self.redraw()
            self.ip_entry.focus_set()
            return
        if sel["mode"] == "net" and sel["net"] in ("join", "watch"):
            self.remember_ip(ip)
        self.save()
        preset = {**sel, "name": nick, "ip": ip, "avatar": self.settings["avatar"], "on_result": self.record_result}
        if sel["mode"] == "net" and sel["net"] == "host":
            self.room_beacon = lan.Beacon(self.room_msg, every=1.0)
        self.cv.pack_forget()
        self.game_frame = tk.Frame(self.root, bg=BG)
        self.game_frame.pack(fill="both", expand=True)
        cls = {"chess": chess_game.ChessApp, "yacht": yacht_game.YachtApp, "omok": omok_game.OmokApp}[self.game]
        self.app = cls(self.root, parent=self.game_frame, preset=preset, on_back=self.back_to_menu)

    def back_to_menu(self):
        if self.room_beacon:
            self.room_beacon.stop()
            self.room_beacon = None
        if self.app:
            self.app.shutdown()
        if self.game_frame:
            self.game_frame.destroy()
        self.app = self.game_frame = None
        self.root.title(APP_NAME)
        self.cv.pack(fill="both", expand=True)
        self.screen = "menu"
        self.redraw()

    def on_close(self):
        if self.app:
            self.app.shutdown()
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

    def log_error(exc, val, tb):  # 화면 처리 중 오류는 로그 파일에 남김 (창 모드 exe에서도 확인 가능)
        import tempfile
        import traceback
        with open(os.path.join(tempfile.gettempdir(), "mini_game_room.log"), "a", encoding="utf-8") as f:
            f.write("".join(traceback.format_exception(exc, val, tb)))
    root.report_callback_exception = log_error
    GameRoom(root)
    root.mainloop()


if __name__ == "__main__":
    main()
