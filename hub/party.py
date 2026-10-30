"""게임이 끝난 뒤의 재미 요소: 도발 멘트, 말풍선, 왕관, 결과 카드, 티배깅 이모트"""
import math
import random
import tkinter.font as tkfont

try:  # 반투명 효과(어둡게 깔기, 빛, 분노 빨강, 김)
    from PIL import Image, ImageDraw, ImageTk
except ImportError:
    Image = None
try:
    import ui_kit
except ImportError:
    ui_kit = None

WIN_LINES = ["ㅋㅋ 이게 실력이지", "다음엔 연습 좀 해 와~", "GG! 너무 쉬웠다", "1등 자리 따뜻하다~",
             "한 판 더? 또 이길 건데", "내가 좀 하지?", "박수 쳐 줘 짝짝짝", "오늘 감 좋네 ㅎㅎ"]
LOSE_LINES = ["운빨이잖아!!", "한 판 더 해!", "인정... 잘했다 ㅠ", "다음엔 내가 이긴다", "봐준 거야 진짜로",
              "GG... 분하다", "방금 건 연습 경기", "복수한다 기다려라"]
DRAW_LINES = ["무승부 ㅋㅋ 다시!", "막상막하네", "이건 인정이지", "한 판 더 해서 끝장 보자"]
TAUNTS = ["ㅋㅋㅋㅋㅋ", "킹받쥬?", "약오르지~", "-100 자존심", "ㅎㅎ 앉았다 일어났다"]
TEABAG_TIME = 3.4  # 티배깅 이모트 길이(초)
TB_GO = 0.35  # 날아가는 시간
TB_BOUNCE = 9  # 앉았다 일어나는 속도
CONFETTI = ["#FFC94D", "#FF5C8A", "#3DDC97", "#7C5CFF", "#4DABF7", "#FF8A4C"]


def pick_lines(kind, n=4):
    """kind: 'win' / 'lose' / 'draw'. 버튼에 쓸 멘트 n개를 무작위로 고름."""
    pool = {"win": WIN_LINES, "lose": LOSE_LINES}.get(kind, DRAW_LINES)
    return random.sample(pool, min(n, len(pool)))


def reply_line(kind):
    """컴퓨터가 받아치는 멘트."""
    return random.choice({"win": WIN_LINES, "lose": LOSE_LINES}.get(kind, DRAW_LINES))


def _round_rect(cv, x0, y0, x1, y1, r, **kw):
    r = max(min(r, (x1 - x0) / 2, (y1 - y0) / 2), 0)
    pts = [x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r, x1, y1 - r, x1, y1,
           x1 - r, y1, x0 + r, y1, x0, y1, x0, y1 - r, x0, y0 + r, x0, y0]
    return cv.create_polygon(pts, smooth=True, **kw)


def _rr(cv, x0, y0, x1, y1, r, fill, tags=(), outline=None, width=0):
    """매끈한 둥근 사각형 (ui_kit이 없으면 tk 도형)."""
    if ui_kit is not None:
        return ui_kit.round_rect(cv, x0, y0, x1, y1, r, fill, outline=outline, width=width, tags=tags)
    return _round_rect(cv, x0, y0, x1, y1, r, fill=fill, outline=outline or "", width=width, tags=tags)


def draw_bubble(cv, x, y, text, font, tags=(), fill="#FFFFFF", fg="#2E2923"):
    """(x, y)를 가리키는 말풍선 (꼬리가 아래로)."""
    tid = cv.create_text(x, y - 26, text=text, fill=fg, font=font, tags=tags)
    x0, y0, x1, y1 = cv.bbox(tid)
    pad = 10
    _rr(cv, x0 - pad, y0 - 6, x1 + pad, y1 + 6, 12, fill, tags=tags)
    cv.create_polygon(x - 7, y1 + 5, x + 7, y1 + 5, x, y1 + 14, fill=fill, outline="", tags=tags)
    cv.tag_raise(tid)


def draw_crown(cv, x, y, w, tags=()):
    """(x, y)를 바닥 가운데로 하는 왕관."""
    h = w * 0.62
    pts = [x - w / 2, y, x - w / 2, y - h * 0.55, x - w / 4, y - h * 0.25, x, y - h, x + w / 4, y - h * 0.25,
           x + w / 2, y - h * 0.55, x + w / 2, y]
    cv.create_polygon(pts, fill="#FFC94D", outline="#C98A12", width=2, tags=tags)
    for dx in (-w / 2, 0, w / 2):
        yy = y - (h if dx == 0 else h * 0.55)
        cv.create_oval(x + dx - w * 0.07, yy - w * 0.07, x + dx + w * 0.07, yy + w * 0.07, fill="#FF5C8A",
                       outline="", tags=tags)


def teabag_pos(t, home, target, size):
    """티배깅: 시작 후 t초일 때 공격자 프로필 위치. 끝났으면 None.

    상대 머리 위로 날아가 통통 앉았다 일어나기를 반복한 뒤 제자리로 돌아옴.
    """
    if t >= TEABAG_TIME:
        return None
    hx, hy = home
    tx, ty = target[0], target[1] - size * 0.62
    go, back = TB_GO, TEABAG_TIME - TB_GO
    if t < go:
        e = 1 - (1 - t / go) ** 3
        return hx + (tx - hx) * e, hy + (ty - hy) * e - math.sin(e * math.pi) * size * 0.8
    if t > back:
        e = 1 - (1 - (t - back) / (TEABAG_TIME - back)) ** 3
        return tx + (hx - tx) * e, ty + (hy - ty) * e - math.sin(e * math.pi) * size * 0.8
    return tx, ty - abs(math.sin((t - go) * TB_BOUNCE)) * size * 0.4


# ---------------------------------------------------------------- 반투명 그림 (Pillow)
_img_cache = {}


def _cached(key, make):
    img = _img_cache.get(key)
    if img is None:
        if len(_img_cache) > 400:
            _img_cache.clear()
        img = _img_cache[key] = ImageTk.PhotoImage(make())
    return img


def _rgb(col):
    return tuple(int(col[i:i + 2], 16) for i in (1, 3, 5))


def _glow(r, color, alpha):
    """가운데가 진하고 바깥으로 갈수록 투명한 동그란 빛."""
    r = max(int(r), 2)

    def make():
        im = Image.new("RGBA", (2 * r, 2 * r), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        steps = 24
        for k in range(steps, 0, -1):
            rr = r * k / steps
            a = int(alpha * (1 - k / steps) ** 1.4)
            d.ellipse((r - rr, r - rr, r + rr, r + rr), fill=_rgb(color) + (a,))
        return im
    return _cached(("glow", r, color, alpha), make)


def _disc(r, color, alpha):
    """반투명 동그라미 (가장자리 매끈)."""
    r = max(int(r), 2)

    def make():
        ss = 3
        im = Image.new("RGBA", (2 * r * ss, 2 * r * ss), (0, 0, 0, 0))
        ImageDraw.Draw(im).ellipse((0, 0, 2 * r * ss - 1, 2 * r * ss - 1), fill=_rgb(color) + (alpha,))
        return im.resize((2 * r, 2 * r), Image.LANCZOS)
    return _cached(("disc", r, color, alpha), make)


def _dim(w, h, alpha):
    w, h = max(int(w), 1), max(int(h), 1)
    return _cached(("dim", w, h, alpha), lambda: Image.new("RGBA", (w, h), (10, 8, 24, alpha)))


def _card(w, h, r, top, bottom, outline, alpha=255):
    """위->아래 그라데이션 + 매끈한 둥근 모서리 카드."""
    w, h = max(int(w), 4), max(int(h), 4)

    def make():
        ss = 2
        W, H = w * ss, h * ss
        grad = Image.new("RGBA", (1, H))
        a, b = _rgb(top), _rgb(bottom)
        for y in range(H):
            t = y / max(H - 1, 1)
            grad.putpixel((0, y), tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (alpha,))
        grad = grad.resize((W, H))
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, W - 1, H - 1), r * ss, fill=255)
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        im.paste(grad, (0, 0), mask)
        if outline:
            ImageDraw.Draw(im).rounded_rectangle((1, 1, W - 2, H - 2), r * ss, outline=_rgb(outline) + (255,),
                                                 width=2 * ss)
        return im.resize((w, h), Image.LANCZOS)
    return _cached(("card", w, h, r, top, bottom, outline, alpha), make)


def _vein(size):
    """화난 표시 (빨간 '#' 모양 핏줄)."""
    size = max(int(size), 6)

    def make():
        ss = 4
        S = size * ss
        im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        c, R, w = S / 2, S / 2, max(int(S * 0.12), 2)
        for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            pts = [(c + sx * R * 0.22, c + sy * R * 0.85), (c + sx * R * 0.22, c + sy * R * 0.3),
                   (c + sx * R * 0.3, c + sy * R * 0.22), (c + sx * R * 0.85, c + sy * R * 0.22)]
            d.line(pts, fill=(232, 33, 58, 255), width=w, joint="curve")
            for px, py in (pts[0], pts[-1]):
                d.ellipse((px - w / 2, py - w / 2, px + w / 2, py + w / 2), fill=(232, 33, 58, 255))
        return im.resize((size, size), Image.LANCZOS)
    return _cached(("vein", size), make)


# ---------------------------------------------------------------- 결과 화면 꾸미기
def draw_backdrop(cv, box, tags=(), seed=3):
    """결과 카드: 그림자 + 그라데이션 카드 + 색종이."""
    x0, y0, x1, y1 = box
    if Image is not None:
        cv.create_image(x0 + 6, y0 + 10, anchor="nw", image=_card(x1 - x0, y1 - y0, 26, "#0B0918", "#0B0918", None),
                        tags=tags)
        cv.create_image(x0, y0, anchor="nw", image=_card(x1 - x0, y1 - y0, 26, "#3B2C7A", "#1C1636", "#7C5CFF"),
                        tags=tags)
    else:
        _round_rect(cv, x0 + 6, y0 + 10, x1 + 6, y1 + 10, 24, fill="#0B0918", outline="", tags=tags)
        _round_rect(cv, x0, y0, x1, y1, 24, fill="#221E3D", outline="#7C5CFF", width=2, tags=tags)
    confetti(cv, (x0 + 14, y0 + 10, x1 - 14, y1 - 10), tags=tags, seed=seed)


def confetti(cv, box, tags=(), seed=3, n=34):
    """정해진 자리에 흩뿌린 색종이 (가장자리 위주라 내용은 안 가림)."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if w < 40 or h < 40:
        return
    rnd = random.Random(seed)
    for _ in range(n):
        side = rnd.random()
        if side < 0.5:  # 위쪽 띠
            x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y0 + h * 0.16)
        else:  # 왼쪽/오른쪽 띠
            x = rnd.uniform(x0, x0 + w * 0.1) if side < 0.75 else rnd.uniform(x1 - w * 0.1, x1)
            y = rnd.uniform(y0, y1 - h * 0.25)
        col = rnd.choice(CONFETTI)
        a = rnd.uniform(0, math.pi)
        if rnd.random() < 0.6:
            lw, lh = rnd.uniform(3, 5), rnd.uniform(7, 11)
            ca, sa = math.cos(a), math.sin(a)
            pts = []
            for px, py in ((-lw / 2, -lh / 2), (lw / 2, -lh / 2), (lw / 2, lh / 2), (-lw / 2, lh / 2)):
                pts += [x + px * ca - py * sa, y + px * sa + py * ca]
            cv.create_polygon(pts, fill=col, outline="", tags=tags)
        elif Image is not None:
            cv.create_image(x, y, image=_disc(rnd.uniform(2, 4), col, 255), tags=tags)


def spotlight(cv, x, y, r, color="#FFC94D", tags=()):
    """1등 뒤에 은은한 빛."""
    if Image is not None:
        cv.create_image(x, y, image=_glow(r, color, 150), tags=tags)


# ---------------------------------------------------------------- 티배깅 효과 (당하는 쪽이 더 열받게)
def _contact(t):
    """티배깅이 상대 머리에 닿는 순간일수록 1에 가까움."""
    if not TB_GO < t < TEABAG_TIME - TB_GO:
        return 0.0, 0
    u = (t - TB_GO) * TB_BOUNCE
    k = int(u // math.pi)
    v = u - k * math.pi
    return max(0.0, 1 - min(v, math.pi - v) / 0.5), k


def teabag_shake(t, size):
    """당하는 사람 프로필이 눌릴 때 흔들리는 정도 (dx, dy)."""
    c, _ = _contact(t)
    return math.sin(t * 95) * size * 0.06 * c, size * 0.07 * c


def draw_teabag_fx(cv, t, target, font, tags=(), layer="under"):
    """target=(x, y, 크기). layer='under': 빨갛게 달아오르는 얼굴, 핏줄, 김 (공격자 프로필 아래)
    layer='over': 쿵! 충격, 놀리는 글자 (맨 위)"""
    if t >= TEABAG_TIME:
        return
    if layer == "over":
        _teabag_over(cv, t, target, font, tags)
        return
    tx, ty, ts = target
    back = TEABAG_TIME - TB_GO
    rage = min(max((t - TB_GO) / 1.2, 0), 1) if t < back else max(0.0, 1 - (t - back) / TB_GO)
    if Image is not None and rage > 0:  # 얼굴이 빨갛게
        dx, dy = teabag_shake(t, ts)
        cv.create_image(tx + dx, ty + dy, image=_disc(ts / 2, "#FF1F3D", int(25 + rage * 110) // 15 * 15), tags=tags)
        for k in range(3):  # 머리 양옆으로 김이 폴폴
            ph = (t * 1.5 + k / 3) % 1
            for side in (-1, 1):
                x = tx + side * (ts * 0.5 + ph * ts * 0.28)
                y = ty - ts * 0.15 - ph * ts * 0.65
                cv.create_image(x, y, image=_disc(ts * (0.07 + ph * 0.09), "#F2F2F2",
                                                  int((1 - ph) * rage * 200) // 20 * 20 + 10), tags=tags)
    if rage > 0.15 and Image is not None:  # 핏줄 (두근두근)
        pulse = 1 + 0.22 * math.sin(t * 16)
        cv.create_image(tx + ts * 0.42, ty - ts * 0.4, image=_vein(ts * 0.3 * pulse), tags=tags)
        if rage > 0.6:
            cv.create_image(tx - ts * 0.45, ty - ts * 0.22, image=_vein(ts * 0.22 * (2 - pulse)), tags=tags)


def _teabag_over(cv, t, target, font, tags):
    tx, ty, ts = target
    c, k = _contact(t)
    if c > 0:  # 머리에 닿을 때 쿵! 충격
        hx, hy = tx, ty - ts * 0.48
        for i in range(10):
            a = i / 10 * math.tau + k
            r0, r1 = ts * 0.2, ts * (0.32 + 0.22 * c)
            cv.create_line(hx + math.cos(a) * r0, hy + math.sin(a) * r0 * 0.6, hx + math.cos(a) * r1,
                           hy + math.sin(a) * r1 * 0.6, fill="#FFE066" if i % 2 else "#FFFFFF",
                           width=max(ts * 0.035, 2), capstyle="round", tags=tags)
        word = ("쿵!", "퍽!", "콩!")[k % 3]
        fx = hx + (ts * 0.55 if k % 2 else -ts * 0.55)
        size = -int(ts * (0.28 + 0.12 * c))
        for ox, oy in ((-2, 0), (2, 0), (0, -2), (0, 2)):
            cv.create_text(fx + ox, hy - ts * 0.1 + oy, text=word, fill="#2A1033", font=(font[0], size, font[1]),
                           tags=tags)
        cv.create_text(fx, hy - ts * 0.1, text=word, fill="#FFE066", font=(font[0], size, font[1]), tags=tags)
    for i, text in enumerate(TAUNTS[:4]):  # 놀리는 글자가 하나씩 떠오름
        start = TB_GO + i * 0.6
        p = (t - start) / 1.3
        if 0 <= p <= 1:
            x = tx + (i % 2 * 2 - 1) * ts * (0.55 + p * 0.2)
            y = ty + ts * 0.3 - p * ts * 1.3
            col = ("#FF5C8A", "#FFC94D", "#3DDC97", "#FF8A4C")[i]
            fs = -max(int(ts * 0.3 * (0.8 + 0.4 * min(p * 4, 1))), 12)
            for ox, oy in ((-2, 0), (2, 0), (0, -2), (0, 2)):
                cv.create_text(x + ox, y + oy, text=text, fill="#1A1033", font=(font[0], fs, font[1]), tags=tags)
            cv.create_text(x, y, text=text, fill=col, font=(font[0], fs, font[1]), tags=tags)


# ---------------------------------------------------------------- 1:1 결과 카드 (체스 / 오목)
def draw_duel_result(cv, area, res, left, other, name_of, draw_av, teabag, bubbles, now, can_teabag, fonts,
                     close, emote, do_teabag, palette, tags="result", dyn=False, dim_box=None):
    """area 안에 들어가게 결과 카드를 그림. 반환: 클릭 영역 [(x0, y0, x1, y1, 할 일)]

    dyn=True면 움직이는 부분(프로필, 티배깅, 말풍선)만 다시 그림 - 애니메이션 중 매 프레임 가볍게.
    dim_box=(x0, y0, x1, y1, 반지름): 카드 뒤 판을 둥글게 어둡게 깔 영역.
    """
    ui, num, bold = fonts
    gold, text_c, muted, danger, card_c, bg_c = palette
    dt = (tags, tags + "_dyn")
    ax0, ay0, ax1, ay1 = area
    aw, ah = ax1 - ax0, ay1 - ay0
    cw, ch = max(min(aw - 24, 580), 200), max(min(ah - 24, 420), 200)
    k = max(min(1.0, cw / 540, ch / 400), 0.55)  # 창이 작으면 안의 글자/그림도 작게

    def F(size, family=ui):
        return (family, -max(int(size * k * 1.33), 9), bold)

    cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
    x0, y0, x1, y1 = cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2
    winner = res["winner"]
    right = other(left)
    ay = y0 + 92 * k + (ch - 92 * k - 110 * k) * 0.45
    big, small = (88 * k, 66 * k) if winner else (74 * k, 74 * k)
    spots = {left: (cx - cw * 0.24, ay, big), right: (cx + cw * 0.24, ay, small)}
    hits = [(x1 - 44 * k, y0 + 4, x1 - 4, y0 + 44 * k, close)]

    if not dyn:
        if dim_box and Image is not None:  # 판을 둥글게 어둡게
            bx0, by0, bx1, by1, br = dim_box
            cv.create_image(bx0, by0, anchor="nw", image=_card(bx1 - bx0, by1 - by0, br, "#0A0818", "#0A0818", None,
                                                               alpha=120), tags=tags)
        draw_backdrop(cv, (x0, y0, x1, y1), tags=tags)
        cv.create_text(x1 - 24 * k, y0 + 24 * k, text="✕", fill=muted, font=F(13), tags=tags)
        title = "무승부" if winner is None else "승리!"
        cv.create_text(cx, y0 + 38 * k + 3, text=title, fill="#120E2A", font=F(24), tags=tags)
        cv.create_text(cx, y0 + 38 * k, text=title, fill=gold, font=F(24), tags=tags)
        cv.create_text(cx, y0 + 74 * k, text="  ·  ".join(res["comments"]), fill=text_c, font=F(11), tags=tags,
                       width=cw - 50, justify="center")
        cv.create_text(cx, ay, text="VS", fill=muted, font=F(18, num), tags=tags)
        if winner:
            spotlight(cv, spots[winner][0], ay, big * 1.15, tags=tags)
        for color, (x, y, size) in spots.items():
            cv.create_text(x, y + size / 2 + 18 * k, text=name_of(color), fill=text_c, font=F(11), tags=tags)
            if winner:
                cv.create_text(x, y + size / 2 + 40 * k, text="WIN" if color == winner else "LOSE",
                               fill=gold if color == winner else danger, font=F(12, num), tags=tags)
        if res["tally"]:
            cv.create_text(cx, y1 - 70 * k, text=res["tally"], fill=muted, font=F(9), tags=tags, width=cw - 40)

    # 멘트 버튼 (+ 이긴 사람만 티배깅) - 카드 폭을 넘지 않게
    labels = [("emote", t) for t in res["opts"]] + ([("teabag", "티배깅!")] if can_teabag else [])
    fsize = 10
    while True:
        font = tkfont.Font(family=ui, size=-max(int(fsize * k * 1.33), 9), weight=bold)
        widths = [font.measure(t) + 24 * k for _, t in labels]
        total = sum(widths) + 8 * (len(widths) - 1)
        if total <= cw - 30 or not labels:
            break
        if len(labels) > 2:
            del labels[-2 if can_teabag else -1]
        elif fsize > 7:
            fsize -= 1
        else:
            break
    bh = 32 * k
    by1 = y1 - 16 * k
    x = cx - total / 2
    for (kind, t), w in zip(labels, widths):
        action = do_teabag if kind == "teabag" else (lambda tx=t: emote(tx))
        hits.append((x, by1 - bh, x + w, by1, action))
        if not dyn:
            _rr(cv, x, by1 - bh, x + w, by1, bh / 2, gold if kind == "teabag" else card_c, tags=tags)
            cv.create_text(x + w / 2, by1 - bh / 2, text=t, fill=bg_c if kind == "teabag" else text_c, font=font,
                           tags=tags)
        x += w + 8

    # 움직이는 부분: 프로필, 왕관, 티배깅, 말풍선
    cv.delete(tags + "_dyn")
    tb = teabag
    t_tb = now - tb["t0"] if tb else 0
    bubble_at = dict(spots)
    for color, (x, y, size) in spots.items():
        if tb and tb["actor"] == color:
            continue
        if tb and tb["target"] == color:  # 당하는 쪽은 눌릴 때마다 흔들림
            dx, dy = teabag_shake(t_tb, size)
            draw_av(cv, x + dx, y + dy, size, color, dt)
        else:
            draw_av(cv, x, y, size, color, dt)
        if color == winner:
            draw_crown(cv, x, y - size / 2 + 2, size * 0.5, tags=dt)
    if tb and tb["actor"] in spots and tb["target"] in spots:
        x, y, size = spots[tb["actor"]]
        tx, ty, tsize = spots[tb["target"]]
        pos = teabag_pos(t_tb, (x, y), (tx, ty), tsize)
        if pos:
            draw_teabag_fx(cv, t_tb, (tx, ty, tsize), (ui, bold), tags=dt)
            draw_av(cv, pos[0], pos[1], size, tb["actor"], dt)
            draw_teabag_fx(cv, t_tb, (tx, ty, tsize), (ui, bold), tags=dt, layer="over")
            bubble_at[tb["actor"]] = (pos[0], pos[1], size)
    for color, (text, exp) in bubbles.items():
        if exp > now and color in bubble_at:
            x, y, size = bubble_at[color]
            draw_bubble(cv, x, y - size / 2 - 2, text, F(10), tags=dt)
    return hits
