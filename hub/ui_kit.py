"""게임 화면 공통 꾸미기: 그라데이션 배경, 매끈한 둥근 카드/버튼, 참가자 카드

- 배경은 창 전체 좌표 기준으로 그려서, 여러 캔버스가 나란히 있어도 이음매 없이 이어짐
- 둥근 모양은 Pillow로 크게 그린 뒤 줄여서(안티앨리어싱) 가장자리가 매끈함 (Pillow가 없으면 tk 도형)
"""
import tkinter as tk
import tkinter.font as tkfont

try:
    from PIL import Image, ImageDraw, ImageTk
except ImportError:
    Image = None
try:
    import avatars
except ImportError:
    avatars = None

STOPS = ("#1A1446", "#2B1A5E", "#3E1D5C")  # 위 -> 가운데 -> 아래
# 빛 번짐: (가로 비율, 세로 비율, 반지름(창 긴 변 비율), 색, 세기)
BLOBS = ((0.04, 0.08, 0.30, "#7C5CFF", 0.20), (0.97, 0.95, 0.34, "#FF5C8A", 0.17),
         (0.93, 0.04, 0.20, "#3DDC97", 0.09), (0.45, 0.62, 0.42, "#5B3DF5", 0.07))
INTROS = {}  # 닉네임 -> 한 줄 소개 (게임룸이 같은 와이파이 친구들 소식으로 채움)
PANEL = "#221E3D"
CARD = "#2F2A52"
TEXT = "#F3F1FF"
MUTED = "#9F9AC8"
ACCENT = "#7C5CFF"
PINK = "#FF5C8A"


def blend(c1, c2, t):
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02X%02X%02X" % tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def grad(y, h):
    t = min(max(y / max(h, 1), 0), 1)
    a, b, c = STOPS
    return blend(a, b, t * 2) if t < 0.5 else blend(b, c, (t - 0.5) * 2)


def _origin(w):
    """위젯의 창 안 위치와 창 크기."""
    top = w.winfo_toplevel()
    return (w.winfo_rootx() - top.winfo_rootx(), w.winfo_rooty() - top.winfo_rooty(),
            max(top.winfo_width(), 1), max(top.winfo_height(), 1))


def paint_backdrop(cv, force=False):
    """캔버스에 창 기준 배경을 'bg' 태그로 그림 (크기/위치가 같으면 다시 안 그림)."""
    w, h = cv.winfo_width(), cv.winfo_height()
    if w < 2 or h < 2:
        return
    ox, oy, W, H = _origin(cv)
    key = (w, h, ox, oy, W, H)
    if not force and getattr(cv, "_bg_key", None) == key and cv.find_withtag("bg"):
        return
    cv._bg_key = key
    cv.delete("bg")
    step = 6
    for y in range(0, h, step):
        cv.create_rectangle(0, y, w, y + step, fill=grad(oy + y, H), width=0, tags="bg")
    big = max(W, H)
    for fx, fy, fr, col, strength in BLOBS:
        bx, by, rad = fx * W - ox, fy * H - oy, fr * big
        if bx + rad < 0 or bx - rad > w or by + rad < 0 or by - rad > h:
            continue
        base = grad(fy * H, H)
        for k in range(16, 0, -1):
            r = rad * k / 16
            cv.create_oval(bx - r, by - r, bx + r, by + r, width=0, tags="bg",
                           fill=blend(base, col, strength * (1 - k / 16) + 0.015))
    cv.tag_lower("bg")


def round_poly(cv, x0, y0, x1, y1, r, **kw):
    r = max(min(r, (x1 - x0) / 2, (y1 - y0) / 2), 0)
    pts = [x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r, x1, y1 - r, x1, y1,
           x1 - r, y1, x0 + r, y1, x0, y1, x0, y1 - r, x0, y0 + r, x0, y0]
    return cv.create_polygon(pts, smooth=True, **kw)


_rr_cache = {}


def rr_image(w, h, r, fill, outline=None, width=0):
    """가장자리가 매끈한 둥근 사각형 이미지 (투명 배경)."""
    w, h = max(int(w), 2), max(int(h), 2)
    r = max(min(int(r), w // 2, h // 2), 0)
    key = (w, h, r, fill, outline, width)
    img = _rr_cache.get(key)
    if img is None:
        ss = 3
        im = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
        ImageDraw.Draw(im).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), r * ss, fill=fill,
                                             outline=outline, width=int(width * ss) if outline else 0)
        img = ImageTk.PhotoImage(im.resize((w, h), Image.LANCZOS))
        if len(_rr_cache) > 300:
            _rr_cache.clear()
        _rr_cache[key] = img
    return img


def round_rect(cv, x0, y0, x1, y1, r, fill, outline=None, width=0, tags=()):
    """둥근 사각형 (Pillow가 있으면 매끈한 이미지)."""
    if Image is None or x1 - x0 < 2 or y1 - y0 < 2:
        return round_poly(cv, x0, y0, x1, y1, r, fill=fill, outline=outline or "", width=width, tags=tags)
    return cv.create_image(x0, y0, anchor="nw", image=rr_image(x1 - x0, y1 - y0, r, fill, outline, width), tags=tags)


def color_at(X, Y, W, H):
    """창 좌표 (X, Y)의 배경색 (paint_backdrop과 같은 계산)."""
    import math
    c = grad(Y, H)
    big = max(W, H)
    for fx, fy, fr, col, strength in BLOBS:
        bx, by, rad = fx * W, fy * H, fr * big
        d = math.hypot(X - bx, Y - by)
        if d <= rad:
            k = max(math.ceil(d * 16 / rad), 1)
            c = blend(grad(fy * H, H), col, strength * (1 - k / 16) + 0.015)
    return c


_corner_cache = {}


def _corner_img(r, color, which):
    """모서리 덮개: 원호 바깥만 배경색, 가장자리는 매끈하게. which: 0 왼위, 1 오른위, 2 왼아래, 3 오른아래"""
    key = (r, color, which)
    img = _corner_cache.get(key)
    if img is None:
        ss = 4
        R = r * ss
        mask = Image.new("L", (R, R), 255)
        ImageDraw.Draw(mask).ellipse((0, 0, 2 * R, 2 * R), fill=0)  # 왼위 기준: 원 안쪽은 투명
        mask = mask.resize((r, r), Image.LANCZOS)
        if which in (1, 3):
            mask = mask.transpose(Image.FLIP_LEFT_RIGHT)
        if which in (2, 3):
            mask = mask.transpose(Image.FLIP_TOP_BOTTOM)
        im = Image.new("RGBA", (r, r), color)
        im.putalpha(mask)
        img = ImageTk.PhotoImage(im)
        if len(_corner_cache) > 200:
            _corner_cache.clear()
        _corner_cache[key] = img
    return img


def round_corners(cv, r, tags="corners"):
    """네모난 캔버스의 네 모서리를 뒤 배경색으로 덮어 둥글게 보이게 함 (맨 마지막에 부름)."""
    cv.delete(tags)
    w, h = cv.winfo_width(), cv.winfo_height()
    r = int(r)
    if w < 2 * r or h < 2 * r or r < 2:
        return
    ox, oy, W, H = _origin(cv)
    for which, (x, y) in enumerate(((0, 0), (w - r, 0), (0, h - r), (w - r, h - r))):
        col = color_at(ox + x + (0 if which in (0, 2) else r), oy + y + (0 if which in (0, 1) else r), W, H)
        if Image is not None:
            cv.create_image(x, y, anchor="nw", image=_corner_img(r, col, which), tags=tags)
        else:
            cv.create_rectangle(x, y, x + r, y + r, fill=col, width=0, tags=tags)
    cv.tag_raise(tags)


class Surface(tk.Canvas):
    """배경 그라데이션이 깔린 칸 (Frame 대신 써서 틈으로 단색이 안 보이게)."""

    def __init__(self, parent, **kw):
        super().__init__(parent, highlightthickness=0, bd=0, bg=STOPS[0], **kw)
        self.bind("<Configure>", lambda e: paint_backdrop(self), add="+")


class Card(tk.Canvas):
    """둥근 카드. 안에 넣을 위젯은 card.body에 넣음."""

    def __init__(self, parent, fill=PANEL, radius=18, pad=None, on_bg=None, stretch=False, outline=None):
        super().__init__(parent, highlightthickness=0, bd=0, bg=on_bg or STOPS[0])
        self.fill, self.r, self.on_bg, self.stretch, self.outline = fill, radius, on_bg, stretch, outline
        self.pad = pad if pad is not None else max(int(radius * 0.5), 4)
        self.body = tk.Frame(self, bg=fill)
        self.win = self.create_window(self.pad, self.pad, window=self.body, anchor="nw")
        self.bind("<Configure>", self._draw)
        self.body.bind("<Configure>", self._fit, add="+")

    def _fit(self, e=None):
        p2 = 2 * self.pad
        tk.Canvas.configure(self, width=self.body.winfo_reqwidth() + p2,
                            height=self.body.winfo_reqheight() + p2)

    def _draw(self, e=None):
        w, h = self.winfo_width(), self.winfo_height()
        if w < 2:
            return
        self.delete("deco")
        if self.on_bg is None:
            paint_backdrop(self)
        round_rect(self, 0, 0, w, h, self.r, self.fill, self.outline, 2 if self.outline else 0, tags="deco")
        self.tag_lower("deco")
        self.tag_lower("bg")
        # 배치된 폭이 내용 폭과 다를 때만 맞춤 (같으면 내용 크기 그대로라 글자가 길어지면 카드도 커짐)
        inner_w = w - 2 * self.pad
        forced = abs(inner_w - self.body.winfo_reqwidth()) > 1
        self.itemconfig(self.win, width=max(inner_w, 1) if forced else 0,
                        height=max(h - 2 * self.pad, 1) if self.stretch else 0)

    def set_fill(self, fill, outline=None):
        if fill == self.fill and outline == self.outline:
            return
        self.fill, self.outline = fill, outline
        self.body.config(bg=fill)
        self._draw()

    def configure(self, cnf=None, **kw):
        if "bg" in kw and getattr(self, "body", None) is not None:
            self.set_fill(kw.pop("bg"))
        if cnf or kw:
            return tk.Canvas.configure(self, cnf, **kw)

    config = configure


class RoundButton(tk.Canvas):
    """알약 모양 버튼 (맥/윈도우 같은 모양). config(text=, bg=, fg=)로 바꿀 수 있음."""

    def __init__(self, parent, text, command, bg=ACCENT, fg="white", font=("TkDefaultFont", 10), on_bg=None,
                 padx=14, pady=7, radius=None):
        self.text, self.command, self.fill, self.fg, self.font = text, command, bg, fg, font
        self.on_bg, self.padx, self.pady, self.radius = on_bg, padx, pady, radius
        self.hover = False
        f = tkfont.Font(family=font[0], size=font[1], weight=font[2] if len(font) > 2 else "normal")
        self.measure = f
        super().__init__(parent, highlightthickness=0, bd=0, bg=on_bg or STOPS[0], cursor="hand2",
                         width=f.measure(text) + 2 * padx, height=f.metrics("linespace") + 2 * pady)
        self.bind("<Configure>", lambda e: self._draw())
        self.bind("<Enter>", lambda e: self._set_hover(True))
        self.bind("<Leave>", lambda e: self._set_hover(False))
        self.bind("<Button-1>", lambda e: self.command and self.command())

    def _set_hover(self, on):
        self.hover = on
        self._draw()

    def _draw(self):
        w, h = self.winfo_width(), self.winfo_height()
        if w < 2:
            return
        self.delete("btn")
        if self.on_bg is None:
            paint_backdrop(self)
        fill = blend(self.fill, "#FFFFFF", 0.14) if self.hover else self.fill
        r = self.radius if self.radius is not None else h / 2
        round_rect(self, 0, 0, w, h, r, fill, tags="btn")
        self.create_text(w / 2, h / 2, text=self.text, fill=self.fg, font=self.font, tags="btn")

    def configure(self, cnf=None, **kw):
        changed = False
        for key, attr in (("text", "text"), ("bg", "fill"), ("fg", "fg")):
            if key in kw:
                setattr(self, attr, kw.pop(key))
                changed = True
        if changed and "width" not in kw:
            kw["width"] = self.measure.measure(self.text) + 2 * self.padx
        if cnf or kw:
            tk.Canvas.configure(self, cnf, **kw)
        if changed:
            self._draw()

    config = configure


def segment(parent, var, options, font, on_bg=PANEL, off=CARD, on=ACCENT, gap=4, pady=6, side_fill=True):
    """여러 개 중 하나 고르는 둥근 버튼 줄. 고른 값은 var에."""
    cells = {}

    def paint(*_):
        for value, cell in cells.items():
            sel = var.get() == value
            cell.config(bg=on if sel else off, fg="white" if sel else TEXT)

    for i, (value, text) in enumerate(options):
        cell = RoundButton(parent, text, lambda v=value: var.set(v), bg=off, fg=TEXT, font=font, on_bg=on_bg,
                           padx=10, pady=pady)
        if side_fill:
            cell.pack(side="left", fill="x", expand=True, padx=(0 if i == 0 else gap, 0))
        else:
            cell.pack(side="left", padx=(0, gap))
        cells[value] = cell
    var.trace_add("write", paint)
    paint()
    return cells


class PeopleCard(Card):
    """참가자 현황: 플레이어(프로필·이름·표시)와 관전자 이름."""

    def __init__(self, parent, ui_font, bold, title="참가자", fill=PANEL, on_bg=None):
        super().__init__(parent, fill=fill, radius=18, on_bg=on_bg)
        self.ui_font, self.bold, self.title = ui_font, bold, title
        self.key = None
        self.imgs = []
        self.mode = "full"  # "full" / "compact"(한 줄 요약) / None(숨김) - 세로 공간에 따라
        self.last = ([], [])

    def set_mode(self, mode):
        if mode != self.mode:
            self.mode = mode
            self.pad = 5 if mode == "compact" else 9  # 한 줄 요약은 여백도 작게
            self.coords(self.win, self.pad, self.pad)
            self.key = None
            self.update_people(*self.last)

    def update_people(self, players, specs):
        """players: [(avatar spec, 이름, 표시 글자, 강조 여부)], specs: [관전자 이름]"""
        self.last = (players, specs)
        key = (repr(players), tuple(specs), self.mode, tuple(INTROS.get(p[1].replace("  (나)", "").strip(), "")
                                                              for p in players))
        if key == self.key:
            return
        self.key = key
        for child in self.body.winfo_children():
            child.destroy()
        self.imgs = []
        b, f = self.body, self.fill
        if self.mode == "compact":  # 좁을 때: 한 줄 요약
            tk.Label(b, text=f"{self.title}  ", bg=f, fg=MUTED, font=(self.ui_font, 9, self.bold)).pack(side="left")
            names = "  vs  ".join(name for _, name, _, _ in players)
            tail = f"   ·   관전 {len(specs)}" if specs else ""
            tk.Label(b, text=names + tail, bg=f, fg=TEXT, font=(self.ui_font, 9, self.bold), anchor="w").pack(
                side="left", fill="x")
            return
        head = tk.Frame(b, bg=f)
        head.pack(fill="x", padx=4)
        tk.Label(head, text=self.title, bg=f, fg=MUTED, font=(self.ui_font, 9, self.bold)).pack(side="left")
        tk.Label(head, text=f"플레이어 {len(players)}  ·  관전 {len(specs)}", bg=f, fg=MUTED,
                 font=(self.ui_font, 9)).pack(side="right")
        for spec, name, badge, hot in players:
            row = tk.Frame(b, bg=f)
            row.pack(fill="x", pady=(4, 0))
            if avatars is not None and Image is not None:
                img = avatars.avatar_image(spec or avatars.default_avatar(), 24)
                self.imgs.append(img)
                tk.Label(row, image=img, bg=f).pack(side="left", padx=(2, 6))
            col = tk.Frame(row, bg=f)
            col.pack(side="left", fill="x", expand=True)
            tk.Label(col, text=name, bg=f, fg=TEXT, font=(self.ui_font, 10, self.bold), anchor="w").pack(fill="x")
            intro = INTROS.get(name.replace("  (나)", "").strip())
            if intro:  # 한 줄 소개
                tk.Label(col, text=intro, bg=f, fg=MUTED, font=(self.ui_font, 8), anchor="w").pack(fill="x")
            if badge:
                tk.Label(row, text=badge, bg=f, fg=PINK if hot else MUTED,
                         font=(self.ui_font, 9, self.bold)).pack(side="right", padx=4)
        if specs:
            row = tk.Frame(b, bg=f)
            row.pack(fill="x", pady=(6, 0))
            badge = RoundButton(row, "관전", None, bg=CARD, fg=TEXT, font=(self.ui_font, 8, self.bold), on_bg=f,
                                padx=8, pady=2)
            badge.config(cursor="arrow")
            badge.pack(side="left", padx=(2, 6), anchor="n")
            tk.Label(row, text=", ".join(specs), bg=f, fg=MUTED, font=(self.ui_font, 9), anchor="w",
                     justify="left", wraplength=210).pack(side="left", fill="x")


def _req_h(w):
    """위젯이 원하는 높이 (카드는 안쪽 내용 + 여백)."""
    if isinstance(w, Card):
        return w.body.winfo_reqheight() + 2 * w.pad
    return w.winfo_reqheight()


def refit(widget):
    """안쪽 카드부터 원하는 크기를 다시 계산 (늘려 놓은 카드는 내용이 줄어도 스스로 모르기 때문)."""
    widget.update_idletasks()
    for child in widget.winfo_children():
        refit(child)
    if isinstance(widget, Card):
        widget._fit()
        widget.update_idletasks()


def fit_side_panel(panel, people, people_pack, chat_panel, extra=None, extra_pack=None, extra_min=80,
                   lines=(4, 2)):
    """오른쪽 칸 세로 공간이 모자라면 덜 중요한 것부터 줄임:
    기보 같은 추가 칸 숨김 -> 참가자 한 줄 요약 -> 채팅 줄 수 줄임 -> 참가자 숨김
    (하나씩 적용해 보고 실제 배치에서 모든 칸이 제 높이를 받으면 멈춤)"""
    if panel.winfo_height() < 50:
        return
    big, small = lines
    plans = [(True, "full", big), (False, "full", big), (False, "compact", big), (False, "compact", small),
             (False, "compact", 1), (False, None, 1)]
    if extra is None:
        plans = [p for p in plans if not p[0]]
    for show_extra, mode, n in plans:
        if chat_panel is not None:
            chat_panel.log.config(height=n)
        if extra is not None:
            if show_extra and not extra.winfo_manager():
                extra_pack()
            elif not show_extra and extra.winfo_manager():
                extra.pack_forget()
        if people is not None:
            people.set_mode(mode)
            if mode and not people.winfo_manager() and people.last[0]:
                people_pack()
            elif not mode and people.winfo_manager():
                people.pack_forget()
        refit(panel)
        panel.update()  # 카드 크기는 Configure 이벤트로 바뀌므로 이벤트까지 처리
        ok = all(w.winfo_height() >= _req_h(w) - 2 for w in panel.pack_slaves() if w is not extra)
        if show_extra:
            ok = ok and extra.winfo_height() >= extra_min
        if ok:
            break


def schedule(widget, key, fn):
    """같은 일을 한 번만 (화면이 한가할 때)."""
    jobs = widget.__dict__.setdefault("_ui_jobs", {})
    if not jobs.get(key):
        def run():
            jobs[key] = None
            try:
                fn()
            except tk.TclError:
                pass
        jobs[key] = widget.after_idle(run)


def clean_names(names):
    """네트워크로 받은 관전자 이름 목록 검사."""
    if not isinstance(names, list):
        return []
    return [str(n)[:12] for n in names[:20] if isinstance(n, str)]
