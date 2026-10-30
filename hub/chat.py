"""게임 중 채팅과 스티커(직접 그린 이모지) 팝업

컬러 이모지는 tkinter에서 OS마다 깨질 수 있어서, 스티커는 캔버스 도형으로 직접 그림.
"""
import math
import random
import time
import tkinter as tk

import ui_kit

try:  # 스티커를 매끈하게 (크게 그려서 줄임)
    from PIL import Image, ImageDraw, ImageTk
except ImportError:
    Image = None

STICKERS = [("laugh", "웃음"), ("cry", "눈물"), ("angry", "화남"), ("love", "하트"),
            ("wow", "놀람"), ("cool", "쿨"), ("fire", "불꽃"), ("gg", "GG")]
STICKER_IDS = {s for s, _ in STICKERS}
POPUP_TIME = 1.8  # 스티커 팝업이 떠 있는 시간(초)
MAX_TEXT = 100
AI_TEXTS = ["ㅋㅋㅋ", "집중해!", "오~ 좀 하네", "나도 질 수 없지", "긴장된다...", "ㅎㅎ"]


def _oval(cv, x, y, rx, ry, tags, **kw):
    cv.create_oval(x - rx, y - ry, x + rx, y + ry, tags=tags, **kw)


_sticker_cache = {}


def draw_sticker(cv, x, y, s, sid, tags=()):
    """(x, y) 중심에 지름 약 s인 스티커 (Pillow가 있으면 가장자리가 매끈한 이미지)."""
    size = int(round(s))
    if Image is not None and size >= 4:
        key = (sid, size)
        img = _sticker_cache.get(key)
        if img is None:
            if len(_sticker_cache) > 400:
                _sticker_cache.clear()
            img = _sticker_cache[key] = _sticker_image(sid, size)
        cv.create_image(x, y, image=img, tags=tags)
        if sid == "gg":
            cv.create_text(x, y, text="GG", fill="white", font=("Arial", -max(int(s * 0.42), 6), "bold"), tags=tags)
        return
    _draw_sticker_tk(cv, x, y, s, sid, tags)


def _smooth(pts, rounds=4):
    """tk의 smooth=True처럼 꼭짓점을 둥글게 (닫힌 도형, 차이킨 방식)."""
    for _ in range(rounds):
        out = []
        n = len(pts)
        for i in range(n):
            (ax, ay), (bx, by) = pts[i], pts[(i + 1) % n]
            out += [(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25), (ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75)]
        pts = out
    return pts


def _pil_angles(start, extent):
    """tk 호 각도(반시계) -> Pillow 각도(시계)."""
    return (-(start + extent)) % 360, (-start) % 360 or 360


def _sticker_image(sid, size):
    ss = 4
    s = size * ss
    full = int(s * 1.1) + 4
    im = Image.new("RGBA", (full, full), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = y = full / 2
    r = s / 2
    w = max(size * 0.045, 1.5) * ss
    ink = "#3A2A1A"

    def oval(cx, cy, rx, ry, fill, outline=None, width=0):
        d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=fill, outline=outline, width=int(width) if outline else 0)

    def line(pts, fill, width):
        width = max(int(width), 2)
        d.line(pts, fill=fill, width=width, joint="curve")
        for px, py in (pts[0], pts[-1]):
            d.ellipse((px - width / 2, py - width / 2, px + width / 2, py + width / 2), fill=fill)

    def shape(pts, fill, outline=None, width=0, smooth=False):
        if smooth:
            pts = _smooth(pts)
        d.polygon(pts, fill=fill)
        if outline:
            line(pts + [pts[0]], outline, width)

    def arc(box, start, extent, outline, width, chord_fill=None):
        a, b = _pil_angles(start, extent)
        if chord_fill:
            d.chord(box, a, b, fill=chord_fill, outline=outline, width=int(width))
        else:
            d.arc(box, a, b, fill=outline, width=int(width))

    if sid == "love":
        pts = []
        for k in range(80):
            t = k / 80 * 2 * math.pi
            hx = 16 * math.sin(t) ** 3
            hy = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
            pts.append((x + hx * s / 34, y + hy * s / 34 + s * 0.02))
        shape(pts, "#FF4D6D", "#C9184A", w)
        oval(x - s * 0.18, y - s * 0.16, s * 0.07, s * 0.05, "#FFB3C1")
    elif sid == "fire":
        outer = [(0, -0.5), (0.16, -0.22), (0.28, -0.32), (0.4, 0.05), (0.36, 0.32), (0.0, 0.48), (-0.36, 0.32),
                 (-0.4, 0.02), (-0.24, -0.18), (-0.14, -0.08)]
        inner = [(0, -0.12), (0.18, 0.12), (0.16, 0.3), (0, 0.4), (-0.16, 0.3), (-0.16, 0.12)]
        shape([(x + px * s, y + py * s) for px, py in outer], "#FF7A1A", "#D9480F", w, smooth=True)
        shape([(x + px * s, y + py * s) for px, py in inner], "#FFD43B", smooth=True)
    elif sid == "gg":
        d.rounded_rectangle((x - r, y - r * 0.62, x + r, y + r * 0.62), r * 0.4, fill="#7C5CFF", outline="#4C2EDB",
                            width=int(w))
    else:
        face = {"angry": "#FF8A5B", "cry": "#FFD866"}.get(sid, "#FFD43B")
        oval(x, y, r - w / 2, r - w / 2, face, "#E0A800" if sid != "angry" else "#E0552B", w)
        ey = y - s * 0.08
        if sid == "laugh":  # ^ ^ 눈 + 크게 웃는 입 + 눈물
            for sx in (-1, 1):
                line([(x + sx * s * 0.24, ey + s * 0.03), (x + sx * s * 0.16, ey - s * 0.05),
                      (x + sx * s * 0.08, ey + s * 0.03)], ink, w * 1.4)
                oval(x + sx * s * 0.34, ey + s * 0.08, s * 0.05, s * 0.07, "#74C0FC")
            arc((x - s * 0.24, y - s * 0.12, x + s * 0.24, y + s * 0.32), 180, 180, ink, w, chord_fill="#8B2E2E")
        elif sid == "cry":
            for sx in (-1, 1):
                line([(x + sx * s * 0.08, ey - s * 0.02), (x + sx * s * 0.24, ey + s * 0.04)], ink, w * 1.4)
                shape([(x + sx * s * 0.16, ey + s * 0.06), (x + sx * s * 0.22, ey + s * 0.3),
                       (x + sx * s * 0.1, ey + s * 0.3)], "#4DABF7", smooth=True)
            arc((x - s * 0.16, y + s * 0.14, x + s * 0.16, y + s * 0.34), 0, 180, ink, w * 1.3)
        elif sid == "angry":
            for sx in (-1, 1):
                line([(x + sx * s * 0.28, ey - s * 0.12), (x + sx * s * 0.08, ey - s * 0.02)], ink, w * 1.6)
                oval(x + sx * s * 0.16, ey + s * 0.06, s * 0.045, s * 0.05, ink)
            arc((x - s * 0.16, y + s * 0.16, x + s * 0.16, y + s * 0.36), 0, 180, ink, w * 1.4)
            vx, vy = x + s * 0.3, y - s * 0.32  # 화난 표시
            for a in range(4):
                ang = a * math.pi / 2 + math.pi / 4
                line([(vx + math.cos(ang) * s * 0.03, vy + math.sin(ang) * s * 0.03),
                      (vx + math.cos(ang) * s * 0.1, vy + math.sin(ang) * s * 0.1)], "#E03131", w * 1.3)
        elif sid == "wow":
            for sx in (-1, 1):
                oval(x + sx * s * 0.16, ey, s * 0.07, s * 0.09, "white", ink, w)
                oval(x + sx * s * 0.16, ey + s * 0.01, s * 0.035, s * 0.045, ink)
            oval(x, y + s * 0.22, s * 0.08, s * 0.1, "#8B2E2E", ink, w)
        elif sid == "cool":
            shape([(x - s * 0.38, ey - s * 0.08), (x + s * 0.38, ey - s * 0.08), (x + s * 0.34, ey + s * 0.08),
                   (x + s * 0.06, ey + s * 0.08), (x, ey), (x - s * 0.06, ey + s * 0.08),
                   (x - s * 0.34, ey + s * 0.08)], "#1E1E24")
            line([(x - s * 0.3, ey - s * 0.04), (x - s * 0.2, ey - s * 0.04)], "#6C6C7A", w)
            arc((x - s * 0.18, y + s * 0.04, x + s * 0.22, y + s * 0.3), 200, 120, ink, w * 1.4)
    out = max(full // ss, 1)
    return ImageTk.PhotoImage(im.resize((out, out), Image.LANCZOS))


def _draw_sticker_tk(cv, x, y, s, sid, tags=()):
    """Pillow가 없을 때: 캔버스 도형으로 직접."""
    r = s / 2
    w = max(s * 0.045, 1.5)
    ink = "#3A2A1A"
    if sid == "love":
        pts = []
        for k in range(40):
            t = k / 40 * 2 * math.pi
            hx = 16 * math.sin(t) ** 3
            hy = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
            pts += [x + hx * s / 34, y + hy * s / 34 + s * 0.02]
        cv.create_polygon(pts, fill="#FF4D6D", outline="#C9184A", width=w, smooth=True, tags=tags)
        _oval(cv, x - s * 0.18, y - s * 0.16, s * 0.07, s * 0.05, tags, fill="#FFB3C1", outline="")
        return
    if sid == "fire":
        outer = [(0, -0.5), (0.16, -0.22), (0.28, -0.32), (0.4, 0.05), (0.36, 0.32), (0.0, 0.48), (-0.36, 0.32),
                 (-0.4, 0.02), (-0.24, -0.18), (-0.14, -0.08)]
        inner = [(0, -0.12), (0.18, 0.12), (0.16, 0.3), (0, 0.4), (-0.16, 0.3), (-0.16, 0.12)]
        cv.create_polygon([v for px, py in outer for v in (x + px * s, y + py * s)], fill="#FF7A1A",
                          outline="#D9480F", width=w, smooth=True, tags=tags)
        cv.create_polygon([v for px, py in inner for v in (x + px * s, y + py * s)], fill="#FFD43B",
                          outline="", smooth=True, tags=tags)
        return
    if sid == "gg":
        x0, y0, x1, y1 = x - r, y - r * 0.62, x + r, y + r * 0.62
        rr = r * 0.4
        pts = [x0 + rr, y0, x1 - rr, y0, x1, y0, x1, y0 + rr, x1, y1 - rr, x1, y1, x1 - rr, y1, x0 + rr, y1,
               x0, y1, x0, y1 - rr, x0, y0 + rr, x0, y0]
        cv.create_polygon(pts, smooth=True, fill="#7C5CFF", outline="#4C2EDB", width=w, tags=tags)
        cv.create_text(x, y, text="GG", fill="white", font=("Arial", -int(s * 0.42), "bold"), tags=tags)
        return

    face = {"angry": "#FF8A5B", "cry": "#FFD866"}.get(sid, "#FFD43B")
    _oval(cv, x, y, r, r, tags, fill=face, outline="#E0A800" if sid != "angry" else "#E0552B", width=w)
    ey = y - s * 0.08
    if sid == "laugh":  # ^ ^ 눈 + 크게 웃는 입 + 눈물
        for sx in (-1, 1):
            cv.create_line(x + sx * s * 0.24, ey + s * 0.03, x + sx * s * 0.16, ey - s * 0.05, x + sx * s * 0.08,
                           ey + s * 0.03, fill=ink, width=w * 1.4, capstyle="round", tags=tags)
            _oval(cv, x + sx * s * 0.34, ey + s * 0.08, s * 0.05, s * 0.07, tags, fill="#74C0FC", outline="")
        cv.create_arc(x - s * 0.24, y - s * 0.12, x + s * 0.24, y + s * 0.32, start=180, extent=180,
                      fill="#8B2E2E", outline=ink, width=w, style="chord", tags=tags)
    elif sid == "cry":
        for sx in (-1, 1):
            cv.create_line(x + sx * s * 0.08, ey - s * 0.02, x + sx * s * 0.24, ey + s * 0.04, fill=ink,
                           width=w * 1.4, capstyle="round", tags=tags)  # 처진 눈
            cv.create_polygon(x + sx * s * 0.16, ey + s * 0.06, x + sx * s * 0.22, ey + s * 0.3,
                              x + sx * s * 0.1, ey + s * 0.3, fill="#4DABF7", outline="", smooth=True, tags=tags)
        cv.create_arc(x - s * 0.16, y + s * 0.14, x + s * 0.16, y + s * 0.34, start=0, extent=180, style="arc",
                      outline=ink, width=w * 1.3, tags=tags)
    elif sid == "angry":
        for sx in (-1, 1):
            cv.create_line(x + sx * s * 0.28, ey - s * 0.12, x + sx * s * 0.08, ey - s * 0.02, fill=ink,
                           width=w * 1.6, capstyle="round", tags=tags)
            _oval(cv, x + sx * s * 0.16, ey + s * 0.06, s * 0.045, s * 0.05, tags, fill=ink, outline="")
        cv.create_arc(x - s * 0.16, y + s * 0.16, x + s * 0.16, y + s * 0.36, start=0, extent=180, style="arc",
                      outline=ink, width=w * 1.4, tags=tags)
        vx, vy = x + s * 0.3, y - s * 0.32  # 화난 표시
        for a in range(4):
            ang = a * math.pi / 2 + math.pi / 4
            cv.create_line(vx + math.cos(ang) * s * 0.03, vy + math.sin(ang) * s * 0.03, vx + math.cos(ang) * s * 0.1,
                           vy + math.sin(ang) * s * 0.1, fill="#E03131", width=w * 1.3, tags=tags)
    elif sid == "wow":
        for sx in (-1, 1):
            _oval(cv, x + sx * s * 0.16, ey, s * 0.07, s * 0.09, tags, fill="white", outline=ink, width=w)
            _oval(cv, x + sx * s * 0.16, ey + s * 0.01, s * 0.035, s * 0.045, tags, fill=ink, outline="")
        _oval(cv, x, y + s * 0.22, s * 0.08, s * 0.1, tags, fill="#8B2E2E", outline=ink, width=w)
    elif sid == "cool":
        cv.create_polygon(x - s * 0.38, ey - s * 0.08, x + s * 0.38, ey - s * 0.08, x + s * 0.34, ey + s * 0.08,
                          x + s * 0.06, ey + s * 0.08, x, ey, x - s * 0.06, ey + s * 0.08, x - s * 0.34, ey + s * 0.08,
                          fill="#1E1E24", outline="", tags=tags)
        cv.create_line(x - s * 0.3, ey - s * 0.04, x - s * 0.2, ey - s * 0.04, fill="#6C6C7A", width=w, tags=tags)
        cv.create_arc(x - s * 0.18, y + s * 0.04, x + s * 0.22, y + s * 0.3, start=200, extent=120, style="arc",
                      outline=ink, width=w * 1.4, tags=tags)


def popup_frame(t):
    """팝업 t초 뒤의 (크기 배율, 위로 뜬 거리 비율). 끝났으면 None."""
    if t >= POPUP_TIME:
        return None
    if t < 0.3:  # 통 튀어 오르며 커짐
        k = t / 0.3
        scale = 1 + 0.25 * math.sin(k * math.pi) if k > 0.6 else k / 0.6 * 1.15
    elif t > POPUP_TIME - 0.3:
        scale = (POPUP_TIME - t) / 0.3
    else:
        scale = 1 + 0.04 * math.sin((t - 0.3) * 8)
    return max(scale, 0.01), t / POPUP_TIME


def draw_popups(cv, popups, anchor, size, font, tags=()):
    """떠 있는 스티커 팝업들을 그림. anchor(팝업) -> 그 팝업을 띄울 (x, y). 끝난 것은 목록에서 지움.

    화면을 가리지 않도록 작게, 보낸 사람 쪽 구석에 띄움.
    """
    now = time.monotonic()
    alive = []
    for p in popups:
        fr = popup_frame(now - p["t0"])
        if fr is None:
            continue
        alive.append(p)
        scale, rise = fr
        cx, cy = anchor(p)
        x = cx + p["dx"]
        y = cy - rise * size * 0.35
        draw_sticker(cv, x, y, size * scale, p["sid"], tags=tags)
        if scale > 0.6 and p.get("name"):
            tid = cv.create_text(x, y + size * scale / 2 + 12, text=p["name"], fill="white", font=font, tags=tags)
            x0, y0, x1, y1 = cv.bbox(tid)
            rect = ui_kit.round_rect(cv, x0 - 8, y0 - 3, x1 + 8, y1 + 3, (y1 - y0 + 6) / 2, "#2B2440", tags=tags)
            cv.tag_raise(tid, rect)
    popups[:] = alive
    return bool(alive)


def new_popup(sid, name, who=None):
    """who: 보낸 사람 (게임마다 다름 - 내 쪽/상대 쪽/자리 번호). 팝업 위치를 정할 때 씀."""
    return {"sid": sid, "name": name, "who": who, "t0": time.monotonic(), "dx": random.uniform(-10, 10)}


class ChatPanel(tk.Frame):
    """채팅 기록 + 입력 칸 + 스티커 버튼 줄."""

    def __init__(self, parent, colors, font, bold, on_text, on_sticker, lines=7, title="채팅", width=None):
        bg, card, fg, muted, accent = colors
        super().__init__(parent, bg=bg)
        if width:  # 고정 너비 (안의 글상자 크기에 맞춰 늘어나지 않게)
            self.config(width=width)
            self.pack_propagate(False)
        self.on_text, self.on_sticker = on_text, on_sticker
        self.fg, self.muted = fg, muted
        self.font, self.bold = font, bold
        tk.Label(self, text=title, bg=bg, fg=muted, font=(font, 9, bold), anchor="w").pack(fill="x")
        log_card = ui_kit.Card(self, fill=card, radius=14, pad=5, on_bg=bg, stretch=True)  # 둥근 채팅 기록
        log_card.pack(fill="both", expand=True, pady=(2, 6))
        self.log = tk.Text(log_card.body, height=lines, width=20, bg=card, fg=fg, font=(font, 10), relief="flat", bd=0,
                           wrap="word", padx=4, pady=2, highlightthickness=0, cursor="arrow")
        self.log.pack(fill="both", expand=True)
        self.log.tag_configure("sys", foreground=muted)
        self.log.config(state="disabled")
        self.tags = {}

        row = tk.Frame(self, bg=bg)
        row.pack(fill="x")
        entry_card = ui_kit.Card(row, fill=card, radius=16, pad=5, on_bg=bg)
        entry_card.pack(side="left", fill="x", expand=True)
        self.entry = tk.Entry(entry_card.body, width=8, font=(font, 10), relief="flat", bd=0, bg=card, fg=fg,
                              insertbackground=fg, highlightthickness=0)
        self.entry.pack(fill="x", padx=6, ipady=3)
        self.entry.bind("<Return>", lambda e: self.submit())
        ui_kit.RoundButton(row, "보내기", self.submit, bg=accent, font=(font, 10, bold), on_bg=bg, padx=12,
                           pady=7).pack(side="left", padx=(6, 0))

        self.bar = tk.Canvas(self, height=40, bg=bg, highlightthickness=0, cursor="hand2")
        self.bar.pack(fill="x", pady=(6, 0))
        self.bar.bind("<Configure>", lambda e: self.draw_bar())
        self.bar.bind("<Button-1>", self.on_bar_click)
        self.last_send = 0.0

    def draw_bar(self):
        cv = self.bar
        cv.delete("all")
        w = cv.winfo_width()
        n = len(STICKERS)
        step = w / n
        for i, (sid, _) in enumerate(STICKERS):
            draw_sticker(cv, step * (i + 0.5), 20, min(30, step - 6), sid)

    def on_bar_click(self, e):
        w = self.bar.winfo_width()
        i = int(e.x // (w / len(STICKERS)))
        if 0 <= i < len(STICKERS) and self.ok_to_send():
            self.on_sticker(STICKERS[i][0])

    def ok_to_send(self):
        now = time.monotonic()
        if now - self.last_send < 0.4:  # 너무 빠른 연타 방지
            return False
        self.last_send = now
        return True

    def submit(self):
        text = self.entry.get().strip()[:MAX_TEXT]
        if text and self.ok_to_send():
            self.entry.delete(0, "end")
            self.on_text(text)

    def add(self, name, text, color=None, system=False):
        log = self.log
        log.config(state="normal")
        if system:
            log.insert("end", f"{text}\n", "sys")
        else:
            tag = self.tags.get(color)
            if color and tag is None:
                tag = self.tags[color] = f"c{len(self.tags)}"
                log.tag_configure(tag, foreground=color, font=(self.font, 10, self.bold))
            log.insert("end", f"{name}  ", tag or ())
            log.insert("end", f"{text}\n")
        log.config(state="disabled")
        log.see("end")
