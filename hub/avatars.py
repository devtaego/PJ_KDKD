"""프로필 그림: 귀여운 동물 캐릭터 또는 내 사진

spec 형식
  {"type": "animal", "id": "cat"}           동물 캐릭터
  {"type": "photo", "data": "<base64 PNG>"}  내 사진 (96px로 줄여 저장, 네트워크로도 이 값을 보냄)
"""
import base64
import io
import math

try:  # 사진/매끈한 그림은 Pillow가 있을 때만 (없으면 tk 도형으로 대신 표시)
    from PIL import Image, ImageDraw, ImageTk
except ImportError:
    Image = None

# id, 이름, 얼굴색, 배경색
ANIMALS = [
    ("cat", "고양이", "#FFB570", "#FFE7CC"),
    ("bear", "곰", "#B98157", "#F1DCC8"),
    ("rabbit", "토끼", "#FFFFFF", "#FFD6E6"),
    ("frog", "개구리", "#7ED67A", "#DDF7D2"),
    ("chick", "병아리", "#FFD84D", "#FFF4C2"),
    ("pig", "돼지", "#FFB3C1", "#FFE1E7"),
    ("panda", "판다", "#FFFFFF", "#DCEBFF"),
    ("fox", "여우", "#FF8A4C", "#FFE0CF"),
]
ROBOT = ("robot", "로봇", "#C9D3E3", "#E6ECF5")  # 컴퓨터 플레이어용
_BY_ID = {a[0]: a for a in ANIMALS + [ROBOT]}
MAX_PHOTO_B64 = 60000  # 네트워크로 받은 사진 데이터 상한
_avatar_cache = {}  # PhotoImage는 참조가 사라지면 화면에서 지워지므로 보관


def default_avatar(index=0):
    return {"type": "animal", "id": ANIMALS[index % len(ANIMALS)][0]}


def robot_avatar():
    return {"type": "animal", "id": "robot"}


def valid(spec):
    """네트워크로 받은 값 검사: 이상하면 None."""
    if not isinstance(spec, dict):
        return None
    if spec.get("type") == "animal" and spec.get("id") in _BY_ID:
        return {"type": "animal", "id": spec["id"]}
    data = spec.get("data")
    if spec.get("type") == "photo" and isinstance(data, str) and len(data) <= MAX_PHOTO_B64:
        return {"type": "photo", "data": data}
    return None


def make_photo_spec(path):
    """고른 사진을 가운데 정사각형으로 잘라 96px PNG로 만듦. 실패하면 예외."""
    if Image is None:
        raise RuntimeError("사진을 쓰려면 Pillow가 필요합니다")
    im = Image.open(path).convert("RGB")
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2)).resize((96, 96), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return {"type": "photo", "data": base64.b64encode(buf.getvalue()).decode("ascii")}


def avatar_image(spec, size, ring=None, halo=None):
    """매끈한 동그란 프로필 이미지 (PhotoImage). 4배로 크게 그린 뒤 줄여서 가장자리가 깨지지 않음.
    ring: 테두리 색, halo: 바깥에 한 칸 띄운 고리 색 (선택 표시용)"""
    spec = valid(spec) or default_avatar()
    size = max(int(size), 8)
    key = (spec.get("id"), hash(spec.get("data")), size, ring, halo)
    img = _avatar_cache.get(key)
    if img is not None:
        return img
    ss = 4
    gap, hw = max(size * 0.1, 4), 3
    pad = int(gap + hw + 1) if halo else 1
    full = size + 2 * pad
    im = Image.new("RGBA", (full * ss, full * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = full * ss / 2
    s = size * ss
    drawn = False
    if spec["type"] == "photo":
        try:
            ph = Image.open(io.BytesIO(base64.b64decode(spec["data"]))).convert("RGBA").resize((s, s), Image.LANCZOS)
            mask = Image.new("L", (s, s), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, s - 1, s - 1), fill=255)
            im.paste(ph, (int(c - s / 2), int(c - s / 2)), mask)
            drawn = True
        except Exception:  # 깨진 사진 데이터면 동물 그림으로
            spec = default_avatar()
    if not drawn:
        _paint_animal(_PilPainter(d, c, c), s, size, spec.get("id", "cat"))
    r = s / 2
    if ring:
        d.ellipse((c - r, c - r, c + r, c + r), outline=ring, width=int(max(size * 0.06, 2) * ss))
    if halo:
        rr = r + gap * ss + hw * ss / 2
        d.ellipse((c - rr, c - rr, c + rr, c + rr), outline=halo, width=int(hw * ss))
    img = ImageTk.PhotoImage(im.resize((full, full), Image.LANCZOS))
    if len(_avatar_cache) > 300:
        _avatar_cache.clear()
    _avatar_cache[key] = img
    return img


def draw_avatar(cv, cx, cy, size, spec, tags=(), ring=None, halo=None):
    """(cx, cy) 중심에 지름 size인 동그란 프로필 그림을 그림."""
    if Image is not None:
        try:
            return cv.create_image(cx, cy, image=avatar_image(spec, size, ring, halo), tags=tags)
        except Exception:
            pass
    spec = valid(spec) or default_avatar()
    r = size / 2
    _paint_animal(_TkPainter(cv, cx, cy, tags), size, size, spec.get("id", "cat"))
    if ring:
        cv.create_oval(cx - r, cy - r, cx + r, cy + r, outline=ring, width=max(size * 0.06, 2), tags=tags)


class _TkPainter:
    """tk 캔버스에 그리기 (Pillow가 없을 때)."""
    scale = 1

    def __init__(self, cv, cx, cy, tags):
        self.cv, self.cx, self.cy, self.tags = cv, cx, cy, tags

    def oval(self, x0, y0, x1, y1, fill, outline=None, width=1):
        self.cv.create_oval(self.cx + x0, self.cy + y0, self.cx + x1, self.cy + y1, fill=fill,
                            outline=outline or "", width=width, tags=self.tags)

    def poly(self, pts, fill):
        self.cv.create_polygon([v for x, y in pts for v in (self.cx + x, self.cy + y)], fill=fill, outline="",
                               tags=self.tags)

    def line(self, pts, fill, width):
        self.cv.create_line([v for x, y in pts for v in (self.cx + x, self.cy + y)], fill=fill, width=width,
                            smooth=True, capstyle="round", tags=self.tags)

    def rect(self, x0, y0, x1, y1, fill, radius=0, outline=None, width=1):
        x0, y0, x1, y1 = self.cx + x0, self.cy + y0, self.cx + x1, self.cy + y1
        if radius:
            rr = radius
            pts = [x0 + rr, y0, x1 - rr, y0, x1, y0, x1, y0 + rr, x1, y1 - rr, x1, y1, x1 - rr, y1, x0 + rr, y1,
                   x0, y1, x0, y1 - rr, x0, y0 + rr, x0, y0]
            self.cv.create_polygon(pts, smooth=True, fill=fill, outline=outline or "", width=width, tags=self.tags)
        else:
            self.cv.create_rectangle(x0, y0, x1, y1, fill=fill, outline="", tags=self.tags)


class _PilPainter:
    """Pillow 이미지에 4배 크기로 그리기 (나중에 줄여서 가장자리가 매끈)."""
    scale = 4

    def __init__(self, d, cx, cy):
        self.d, self.cx, self.cy = d, cx, cy

    def oval(self, x0, y0, x1, y1, fill, outline=None, width=1):
        self.d.ellipse((self.cx + x0, self.cy + y0, self.cx + x1, self.cy + y1), fill=fill, outline=outline,
                       width=max(int(width * 4), 1) if outline else 0)

    def poly(self, pts, fill):
        self.d.polygon([(self.cx + x, self.cy + y) for x, y in pts], fill=fill)

    def line(self, pts, fill, width):
        pts = [(self.cx + x, self.cy + y) for x, y in pts]
        w = max(int(width * 4), 2)
        self.d.line(pts, fill=fill, width=w, joint="curve")
        for x, y in (pts[0], pts[-1]):  # 둥근 끝
            self.d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=fill)

    def rect(self, x0, y0, x1, y1, fill, radius=0, outline=None, width=1):
        box = (self.cx + x0, self.cy + y0, self.cx + x1, self.cy + y1)
        if radius:
            self.d.rounded_rectangle(box, radius, fill=fill, outline=outline,
                                     width=max(int(width * 4), 1) if outline else 0)
        else:
            self.d.rectangle(box, fill=fill)


def _paint_animal(P, s, px, kind):
    """동물 얼굴. 좌표는 중심 기준, s = 그리는 지름, px = 화면에서의 지름 (선 굵기용)."""
    _, _, face, bg = _BY_ID.get(kind, ANIMALS[0])
    line = "#3B2F2A"
    r = s / 2
    P.oval(-r, -r, r, r, bg)

    def oval(x, y, rx, ry, fill, outline=None):
        P.oval((x - rx) * s, (y - ry) * s, (x + rx) * s, (y + ry) * s, fill, outline)

    def poly(pts, fill):
        P.poly([(x * s, y * s) for x, y in pts], fill)

    hy, hr = 0.06, 0.3  # 머리 중심 y, 반지름
    # 귀 / 머리 위 장식 (머리보다 먼저 그려서 뒤에 깔리게)
    if kind in ("cat", "fox"):
        for sx in (-1, 1):
            poly([(sx * 0.28, -0.08), (sx * 0.2, -0.36), (sx * 0.06, -0.18)], face)
            poly([(sx * 0.24, -0.11), (sx * 0.19, -0.28), (sx * 0.11, -0.17)], "#FFD9E0" if kind == "cat" else "#FFFFFF")
    elif kind in ("bear", "panda"):
        ear = "#2A2A2E" if kind == "panda" else face
        for sx in (-1, 1):
            oval(sx * 0.22, -0.17, 0.1, 0.1, ear)
            if kind == "bear":
                oval(sx * 0.22, -0.17, 0.05, 0.05, "#E8BFA0")
    elif kind == "rabbit":
        for sx in (-1, 1):
            oval(sx * 0.11, -0.3, 0.07, 0.19, face, "#E9D9E0")
            oval(sx * 0.11, -0.28, 0.035, 0.13, "#FFC2D6")
    elif kind == "pig":
        for sx in (-1, 1):
            poly([(sx * 0.26, -0.1), (sx * 0.24, -0.3), (sx * 0.1, -0.2)], "#F59AAD")
    elif kind == "chick":
        poly([(-0.04, -0.22), (0.0, -0.36), (0.03, -0.22)], face)
        poly([(0.02, -0.22), (0.1, -0.33), (0.08, -0.2)], face)
    elif kind == "robot":
        P.line([(0, -0.24 * s), (0, -0.36 * s)], "#7D8BA3", max(px * 0.03, 1.5))
        oval(0, -0.37, 0.045, 0.045, "#FF5C7A")

    # 머리
    if kind == "robot":
        P.rect(-0.28 * s, -0.24 * s, 0.28 * s, 0.3 * s, face, radius=0.08 * s, outline="#7D8BA3",
               width=max(px * 0.02, 1))
    else:
        oval(0, hy, hr, hr * 0.92, face, "#E5E0DA" if face == "#FFFFFF" else None)
    if kind == "fox":
        poly([(-0.27, 0.08), (0.0, 0.32), (0.27, 0.08), (0.12, 0.22), (-0.12, 0.22)], "#FFFFFF")
    if kind == "panda":
        for sx in (-1, 1):
            oval(sx * 0.11, 0.04, 0.075, 0.09, "#2A2A2E")

    # 눈
    eye_y = 0.04
    if kind == "frog":
        for sx in (-1, 1):
            oval(sx * 0.15, -0.2, 0.1, 0.1, face)
            oval(sx * 0.15, -0.2, 0.065, 0.065, "#FFFFFF")
            oval(sx * 0.15, -0.19, 0.035, 0.035, "#1E1B18")
    elif kind == "robot":
        for sx in (-1, 1):
            P.rect((sx * 0.12 - 0.06) * s, -0.06 * s, (sx * 0.12 + 0.06) * s, 0.04 * s, "#3DDC97", radius=0.02 * s)
        P.line([(-0.1 * s, 0.17 * s), (0.1 * s, 0.17 * s)], "#7D8BA3", max(px * 0.03, 1.5))
        return
    else:
        for sx in (-1, 1):
            oval(sx * 0.11, eye_y, 0.034, 0.042, "#FFFFFF" if kind == "panda" else "#1E1B18")
            oval(sx * 0.11 + 0.012, eye_y - 0.014, 0.012, 0.012, "#FFFFFF" if kind != "panda" else "#1E1B18")

    # 볼터치
    for sx in (-1, 1):
        oval(sx * 0.2, 0.13, 0.045, 0.03, "#FF9DB0")

    # 코 / 입
    w = max(px * 0.025, 1.2)
    if kind == "pig":
        oval(0, 0.15, 0.09, 0.065, "#F59AAD")
        oval(-0.03, 0.15, 0.015, 0.02, "#B8566C")
        oval(0.03, 0.15, 0.015, 0.02, "#B8566C")
    elif kind == "chick":
        poly([(-0.06, 0.12), (0.06, 0.12), (0.0, 0.2)], "#FF9F43")
    elif kind == "bear":
        oval(0, 0.15, 0.1, 0.075, "#E8BFA0")
        oval(0, 0.12, 0.035, 0.025, line)
    else:
        oval(0, 0.12, 0.025, 0.018, line if kind != "rabbit" else "#FF8FB0")
        for sx in (-1, 1):  # w 모양 입
            pts = []
            for k in range(7):
                t = k / 6
                pts.append((sx * t * 0.07 * s, (0.15 + math.sin(t * math.pi) * 0.035) * s))
            P.line(pts, line, w)
