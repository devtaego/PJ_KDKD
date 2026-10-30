"""로컬 체스 게임 (tkinter, 외부 라이브러리 없음)

실행: python chess/chess_game.py
- 내 색(백/흑), 상대(컴퓨터/2인/네트워크), 시간(무제한/10분/3분+2초)을 고른 뒤 '새 게임'
- 기물을 클릭해 선택하고, 표시된 칸을 클릭해 이동
- 네트워크: 같은 와이파이의 두 PC 중 한쪽이 '방 만들기', 다른 쪽이 그 IP로 '참가하기'
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

try:  # 매끈한 기물 이미지용 (없으면 tk 도형으로 대신 그림)
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageTk
except ImportError:
    Image = None

FILES = "abcdefgh"
PORT = 50007
MAX_LINE = 300_000  # 네트워크 메시지 한 줄 최대 길이 (프로필 사진 포함해도 충분)
VALUES = {"P": 100, "N": 320, "B": 330, "R": 500, "Q": 900, "K": 0}

# 기물 모양: 100x100 좌표계의 도형 목록 (아래에서 위 순서로 그림)
#   ("poly", 점들, 곡선여부)  곡선 다각형에서 같은 점을 두 번 쓰면 뾰족한 모서리가 됨
#   ("oval", x0, y0, x1, y1)
#   ("line", 점들)  눈/홈 같은 장식선
BASE_HIGH = ("poly", [(27, 76), (73, 76), (76, 85), (24, 85)], False)
BASE_LOW = ("poly", [(20, 84), (80, 84), (82, 93), (18, 93)], False)
PIECE_SHAPES = {
    "P": [
        ("poly", [(44, 42), (56, 42), (57, 54), (62, 66), (68, 76), (68, 76), (68, 79), (68, 79),
                  (32, 79), (32, 79), (32, 76), (32, 76), (38, 66), (43, 54)], True),
        ("poly", [(29, 76), (71, 76), (74, 84), (26, 84)], False),
        ("poly", [(23, 83), (77, 83), (79, 92), (21, 92)], False),
        ("oval", 34, 38, 66, 47),
        ("oval", 38, 14, 62, 38),
    ],
    "R": [
        ("poly", [(35, 36), (65, 36), (67, 68), (33, 68)], False),
        ("poly", [(29, 66), (71, 66), (73, 77), (27, 77)], False),
        BASE_HIGH, BASE_LOW,
        ("poly", [(26, 9), (36, 9), (36, 17), (45, 17), (45, 9), (55, 9), (55, 17), (64, 17),
                  (64, 9), (74, 9), (74, 27), (67, 36), (33, 36), (26, 27)], False),
        ("line", [(31, 27), (69, 27)]),
    ],
    "B": [
        ("poly", [(43, 57), (57, 57), (59, 66), (66, 75), (66, 75), (66, 78), (66, 78), (34, 78),
                  (34, 78), (34, 75), (34, 75), (41, 66)], True),
        BASE_HIGH, BASE_LOW,
        ("oval", 34, 52, 66, 60),
        ("poly", [(50, 14), (50, 14), (61, 25), (66, 37), (63, 48), (57, 54), (57, 54), (43, 54),
                  (43, 54), (37, 48), (34, 37), (39, 25)], True),
        ("oval", 45, 5, 55, 15),
        ("line", [(55, 27), (46, 40)]),
    ],
    "N": [
        ("poly", [(71, 79), (71, 79), (74, 60), (72, 42), (65, 27), (56, 18), (52, 6), (52, 6),
                  (46, 15), (37, 19), (27, 30), (18, 44), (16, 52), (16, 52), (20, 56), (27, 57),
                  (35, 53), (42, 48), (46, 51), (39, 62), (33, 72), (31, 79), (31, 79)], True),
        BASE_HIGH, BASE_LOW,
        ("oval", 37, 27, 44, 33),
        ("oval", 20, 47, 24, 51),
        ("line", [(61, 24), (68, 40), (70, 58)]),
    ],
    "Q": [
        ("poly", [(33, 68), (33, 68), (28, 48), (22, 28), (22, 28), (36, 46), (39, 24), (39, 24),
                  (48, 44), (50, 20), (50, 20), (52, 44), (61, 24), (61, 24), (64, 46), (78, 28),
                  (78, 28), (72, 48), (67, 68), (67, 68)], True),
        ("oval", 18, 24, 26, 32), ("oval", 35, 20, 43, 28), ("oval", 46, 15, 54, 23),
        ("oval", 57, 20, 65, 28), ("oval", 74, 24, 82, 32),
        ("poly", [(31, 66), (69, 66), (72, 77), (28, 77)], False),
        BASE_HIGH, BASE_LOW,
        ("line", [(36, 58), (64, 58)]),
    ],
    "K": [
        ("poly", [(47, 3), (53, 3), (53, 9), (59, 9), (59, 15), (53, 15), (53, 24), (47, 24),
                  (47, 15), (41, 15), (41, 9), (47, 9)], False),
        ("oval", 41, 21, 59, 35),
        ("poly", [(31, 68), (31, 68), (22, 50), (25, 38), (37, 34), (50, 44), (50, 44), (63, 34),
                  (75, 38), (78, 50), (69, 68), (69, 68)], True),
        ("poly", [(30, 66), (70, 66), (73, 77), (27, 77)], False),
        BASE_HIGH, BASE_LOW,
        ("line", [(50, 46), (50, 62)]),
    ],
}
PIECE_SCALE = 0.86  # 칸 크기 대비 기물 크기


def _shape_bbox(shapes):
    xs, ys = [], []
    for sh in shapes:
        if sh[0] == "oval":
            xs += [sh[1], sh[3]]
            ys += [sh[2], sh[4]]
        else:
            xs += [x for x, _ in sh[1]]
            ys += [y for _, y in sh[1]]
    return min(xs), min(ys), max(xs), max(ys)


# 기물마다 도형 전체의 중심 -> 이 점을 칸 정중앙에 맞춤
PIECE_CENTER = {k: ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
                for k, b in ((k, _shape_bbox(v)) for k, v in PIECE_SHAPES.items())}
PIECE_COLORS = {  # 위쪽 색, 아래쪽 색(그라데이션), 테두리, 장식선
    "w": ("#FFFFFF", "#D6CFBF", "#222222", "#222222"),
    "b": ("#5C5C5C", "#1B1B1B", "#0C0C0C", "#E4E4E4"),
}


def smooth_points(pts, steps=10):
    """tk의 smooth 다각형과 같은 방식(2차 B-스플라인)으로 곡선을 점으로 펼침."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        a = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        b = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
        for s in range(steps):
            t = s / steps
            u = 1 - t
            out.append((u * u * a[0] + 2 * u * t * p1[0] + t * t * b[0],
                        u * u * a[1] + 2 * u * t * p1[1] + t * t * b[1]))
    return out


def render_piece(kind, color, size):
    """Pillow로 4배 크게 그린 뒤 줄여서 가장자리가 매끈한 기물 이미지(RGBA)를 만듦."""
    ss = 4
    w = size * ss
    k = w / 100 * PIECE_SCALE
    ox, oy = PIECE_CENTER[kind]
    top, bottom, outline, detail = PIECE_COLORS[color]
    lw = max(int(w * 0.024), 2)

    def pt(x, y):
        return w / 2 + (x - ox) * k, w / 2 + (y - oy) * k

    grad = Image.composite(Image.new("RGBA", (w, w), bottom), Image.new("RGBA", (w, w), top),
                           Image.linear_gradient("L").resize((w, w)))
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    silhouette = Image.new("L", (w, w), 0)
    pen = ImageDraw.Draw(img)
    for sh in PIECE_SHAPES[kind]:
        if sh[0] == "line":
            continue
        mask = Image.new("L", (w, w), 0)
        md = ImageDraw.Draw(mask)
        if sh[0] == "oval":
            box = [*pt(sh[1], sh[2]), *pt(sh[3], sh[4])]
            md.ellipse(box, fill=255)
            img.paste(grad, (0, 0), mask)
            pen.ellipse(box, outline=outline, width=lw)
        else:
            pts = [pt(x, y) for x, y in (smooth_points(sh[1]) if sh[2] else sh[1])]
            md.polygon(pts, fill=255)
            img.paste(grad, (0, 0), mask)
            pen.line(pts + [pts[0], pts[1]], fill=outline, width=lw, joint="curve")
        silhouette = ImageChops.lighter(silhouette, mask)
    for sh in PIECE_SHAPES[kind]:
        if sh[0] == "line":
            pts = [pt(x, y) for x, y in sh[1]]
            pen.line(pts, fill=detail, width=lw, joint="curve")
            for x, y in (pts[0], pts[-1]):
                pen.ellipse([x - lw / 2, y - lw / 2, x + lw / 2, y + lw / 2], fill=detail)

    # 오른쪽 아래로 은은한 그림자
    shadow_alpha = silhouette.filter(ImageFilter.GaussianBlur(w * 0.025)).point(lambda v: int(v * 0.4))
    shadow = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    shadow.paste(Image.new("RGBA", (w, w), (0, 0, 0, 255)), (int(w * 0.015), int(w * 0.03)), shadow_alpha)
    return Image.alpha_composite(shadow, img).resize((size, size), Image.LANCZOS)


def draw_piece(canvas, kind, color, cx, cy, size, tags=()):
    """Pillow가 없을 때 쓰는 대체 그리기: tk 도형으로 (cx, cy) 중심에 기물을 그림."""
    k = size / 100 * PIECE_SCALE
    ox, oy = PIECE_CENTER[kind]
    top, bottom, outline, detail = PIECE_COLORS[color]
    fill = blend(top, bottom, 0.4)
    width = max(size * 0.026, 1.2)

    def pt(x, y):
        return cx + (x - ox) * k, cy + (y - oy) * k

    for sh in PIECE_SHAPES[kind]:
        if sh[0] == "oval":
            x0, y0 = pt(sh[1], sh[2])
            x1, y1 = pt(sh[3], sh[4])
            canvas.create_oval(x0, y0, x1, y1, fill=fill, outline=outline, width=width, tags=tags)
        elif sh[0] == "poly":
            coords = [v for x, y in sh[1] for v in pt(x, y)]
            canvas.create_polygon(coords, fill=fill, outline=outline, width=width, smooth=sh[2],
                                  joinstyle="round", tags=tags)
        else:
            coords = [v for x, y in sh[1] for v in pt(x, y)]
            canvas.create_line(coords, fill=detail, width=width, capstyle="round", joinstyle="round",
                               tags=tags)


def blend(c1, c2, t):
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02X%02X%02X" % tuple(round(x + (y - x) * t) for x, y in zip(a, b))


KNIGHT_STEPS = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
KING_STEPS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
ROOK_DIRS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
BISHOP_DIRS = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
SLIDE_DIRS = {"R": ROOK_DIRS, "B": BISHOP_DIRS, "Q": ROOK_DIRS + BISHOP_DIRS}
# 해당 칸에서 기물이 움직이거나 잡히면 사라지는 캐슬링 권리
CASTLE_SQUARES = {(7, 4): "KQ", (0, 4): "kq", (7, 7): "K", (7, 0): "Q", (0, 7): "k", (0, 0): "q"}

# 백 기준 위치 점수 (row 0 = 8랭크)
PAWN_PST = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
]
KNIGHT_PST = [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
]


def opponent(color):
    return "b" if color == "w" else "w"


def square_name(r, c):
    return f"{FILES[c]}{8 - r}"


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


class Position:
    """보드 상태. move는 (from_r, from_c, to_r, to_c, promo) 튜플."""

    def __init__(self, empty=False, super_color=None):
        self.board = [[None] * 8 for _ in range(8)]
        self.turn = "w"
        self.super_color = super_color  # 방장 사기 모드: 이 색의 기물(킹 제외)은 나이트 점프도 가능
        self.castling = set("KQkq")
        self.ep = None  # 앙파상으로 잡을 수 있는 칸
        self.halfmove = 0
        if not empty:
            back = "RNBQKBNR"
            for c in range(8):
                self.board[0][c] = "b" + back[c]
                self.board[1][c] = "bP"
                self.board[6][c] = "wP"
                self.board[7][c] = "w" + back[c]

    def copy(self):
        n = Position(empty=True, super_color=self.super_color)
        n.board = [row[:] for row in self.board]
        n.turn = self.turn
        n.castling = set(self.castling)
        n.ep = self.ep
        n.halfmove = self.halfmove
        return n

    def key(self):
        return (tuple(map(tuple, self.board)), self.turn, frozenset(self.castling), self.ep)

    def is_attacked(self, r, c, by):
        b = self.board
        pr = r + 1 if by == "w" else r - 1
        if 0 <= pr < 8:
            for pc in (c - 1, c + 1):
                if 0 <= pc < 8 and b[pr][pc] == by + "P":
                    return True
        jumpers = "QRBNP" if by == self.super_color else "N"
        for dr, dc in KNIGHT_STEPS:
            nr, nc = r + dr, c + dc
            if 0 <= nr < 8 and 0 <= nc < 8:
                p = b[nr][nc]
                if p and p[0] == by and p[1] in jumpers:
                    return True
        for dr, dc in KING_STEPS:
            nr, nc = r + dr, c + dc
            if 0 <= nr < 8 and 0 <= nc < 8 and b[nr][nc] == by + "K":
                return True
        for dirs, kinds in ((ROOK_DIRS, "RQ"), (BISHOP_DIRS, "BQ")):
            for dr, dc in dirs:
                nr, nc = r + dr, c + dc
                while 0 <= nr < 8 and 0 <= nc < 8:
                    p = b[nr][nc]
                    if p:
                        if p[0] == by and p[1] in kinds:
                            return True
                        break
                    nr += dr
                    nc += dc
        return False

    def king_square(self, color):
        for r in range(8):
            for c in range(8):
                if self.board[r][c] == color + "K":
                    return r, c
        return None

    def in_check(self, color):
        ks = self.king_square(color)
        return ks is not None and self.is_attacked(ks[0], ks[1], opponent(color))

    def pseudo_moves(self):
        moves = []
        b = self.board
        color = self.turn
        enemy = opponent(color)
        for r in range(8):
            for c in range(8):
                p = b[r][c]
                if not p or p[0] != color:
                    continue
                kind = p[1]
                if color == self.super_color and kind not in "NK":
                    for dr, dc in KNIGHT_STEPS:
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < 8 and 0 <= nc < 8:
                            t = b[nr][nc]
                            if t is None or t[0] == enemy:
                                if kind == "P":
                                    self._add_pawn(moves, r, c, nr, nc, 0 if color == "w" else 7)
                                else:
                                    moves.append((r, c, nr, nc, None))
                if kind == "P":
                    d = -1 if color == "w" else 1
                    start = 6 if color == "w" else 1
                    last = 0 if color == "w" else 7
                    nr = r + d
                    if b[nr][c] is None:
                        self._add_pawn(moves, r, c, nr, c, last)
                        if r == start and b[r + 2 * d][c] is None:
                            moves.append((r, c, r + 2 * d, c, None))
                    for nc in (c - 1, c + 1):
                        if 0 <= nc < 8:
                            t = b[nr][nc]
                            if t and t[0] == enemy:
                                self._add_pawn(moves, r, c, nr, nc, last)
                            elif (nr, nc) == self.ep:
                                moves.append((r, c, nr, nc, None))
                elif kind in ("N", "K"):
                    for dr, dc in (KNIGHT_STEPS if kind == "N" else KING_STEPS):
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < 8 and 0 <= nc < 8:
                            t = b[nr][nc]
                            if t is None or t[0] == enemy:
                                moves.append((r, c, nr, nc, None))
                    if kind == "K":
                        self._add_castling(moves, color)
                else:
                    for dr, dc in SLIDE_DIRS[kind]:
                        nr, nc = r + dr, c + dc
                        while 0 <= nr < 8 and 0 <= nc < 8:
                            t = b[nr][nc]
                            if t is None:
                                moves.append((r, c, nr, nc, None))
                            else:
                                if t[0] == enemy:
                                    moves.append((r, c, nr, nc, None))
                                break
                            nr += dr
                            nc += dc
        return moves

    @staticmethod
    def _add_pawn(moves, r, c, nr, nc, last):
        if nr == last:
            for promo in "QRBN":
                moves.append((r, c, nr, nc, promo))
        else:
            moves.append((r, c, nr, nc, None))

    def _add_castling(self, moves, color):
        row = 7 if color == "w" else 0
        if self.board[row][4] != color + "K":
            return
        enemy = opponent(color)
        k_right, q_right = ("K", "Q") if color == "w" else ("k", "q")
        b = self.board
        if (k_right in self.castling and b[row][7] == color + "R"
                and b[row][5] is None and b[row][6] is None
                and not any(self.is_attacked(row, c, enemy) for c in (4, 5, 6))):
            moves.append((row, 4, row, 6, None))
        if (q_right in self.castling and b[row][0] == color + "R"
                and b[row][1] is None and b[row][2] is None and b[row][3] is None
                and not any(self.is_attacked(row, c, enemy) for c in (4, 3, 2))):
            moves.append((row, 4, row, 2, None))

    def make(self, move):
        fr, fc, tr, tc, promo = move
        n = self.copy()
        b = n.board
        p = b[fr][fc]
        captured = b[tr][tc]
        if p[1] == "P" and (tr, tc) == self.ep and captured is None:
            b[fr][tc] = None  # 앙파상
            captured = "xP"
        b[tr][tc] = p[0] + promo if promo else p
        b[fr][fc] = None
        if p[1] == "K" and abs(tc - fc) == 2:
            if tc == 6:
                b[tr][5], b[tr][7] = b[tr][7], None
            else:
                b[tr][3], b[tr][0] = b[tr][0], None
        for sq, rights in CASTLE_SQUARES.items():
            if sq == (fr, fc) or sq == (tr, tc):
                n.castling -= set(rights)
        n.ep = ((fr + tr) // 2, fc) if p[1] == "P" and abs(tr - fr) == 2 and fc == tc else None
        n.halfmove = 0 if p[1] == "P" or captured else self.halfmove + 1
        n.turn = opponent(self.turn)
        return n

    def legal_moves(self):
        color = self.turn
        return [m for m in self.pseudo_moves() if not self.make(m).in_check(color)]

    def insufficient_material(self):
        minors = []
        for row in self.board:
            for p in row:
                if p and p[1] != "K":
                    if p[1] in "PRQ":
                        return False
                    minors.append(p)
        return len(minors) <= 1


# ---------------------------------------------------------------- 컴퓨터 AI

def evaluate(pos):
    """현재 둘 차례 기준 점수."""
    score = 0
    for r in range(8):
        for c in range(8):
            p = pos.board[r][c]
            if not p:
                continue
            kind = p[1]
            pr = r if p[0] == "w" else 7 - r
            v = VALUES[kind]
            if kind == "P":
                v += PAWN_PST[pr][c]
            elif kind == "N":
                v += KNIGHT_PST[pr][c]
            elif kind in "BQ":
                v += int(8 - abs(3.5 - r) - abs(3.5 - c)) * 2
            score += v if p[0] == "w" else -v
    return score if pos.turn == "w" else -score


def order_key(pos, m):
    target = pos.board[m[2]][m[3]]
    gain = VALUES[target[1]] * 10 - VALUES[pos.board[m[0]][m[1]][1]] if target else 0
    return gain + (900 if m[4] == "Q" else 0)


def negamax(pos, depth, alpha, beta, ply):
    if depth == 0:
        return evaluate(pos)
    moves = pos.legal_moves()
    if not moves:
        return -100000 + ply if pos.in_check(pos.turn) else 0
    moves.sort(key=lambda m: order_key(pos, m), reverse=True)
    for m in moves:
        score = -negamax(pos.make(m), depth - 1, -beta, -alpha, ply + 1)
        if score >= beta:
            return score
        alpha = max(alpha, score)
    return alpha


def best_move(pos, depth=3):
    moves = pos.legal_moves()
    random.shuffle(moves)
    moves.sort(key=lambda m: order_key(pos, m), reverse=True)
    best, alpha = moves[0], -10 ** 9
    for m in moves:
        score = -negamax(pos.make(m), depth - 1, -10 ** 9, -alpha, 1)
        if score > alpha:
            alpha, best = score, m
    return best


# ---------------------------------------------------------------- 기보 표기

def move_san(pos, m):
    """표준 기보(SAN) 문자열. 예: e4, Nxf3, O-O, e8=Q+"""
    fr, fc, tr, tc, promo = m
    p = pos.board[fr][fc]
    kind = p[1]
    if kind == "K" and abs(tc - fc) == 2:
        s = "O-O" if tc == 6 else "O-O-O"
    else:
        capture = pos.board[tr][tc] is not None or (kind == "P" and (tr, tc) == pos.ep)
        if kind != "N" and abs(tr - fr) * abs(tc - fc) == 2:  # 방장 사기 모드의 나이트 점프
            s = ("" if kind == "P" else kind) + square_name(fr, fc) + ("x" if capture else "-") \
                + square_name(tr, tc) + ("=" + promo if promo else "")
        elif kind == "P":
            s = (FILES[fc] + "x" if capture else "") + square_name(tr, tc) + ("=" + promo if promo else "")
        else:
            others = [o for o in pos.legal_moves()
                      if o[2:4] == (tr, tc) and o[:2] != (fr, fc) and pos.board[o[0]][o[1]] == p]
            dis = ""
            if others:
                if all(o[1] != fc for o in others):
                    dis = FILES[fc]
                elif all(o[0] != fr for o in others):
                    dis = str(8 - fr)
                else:
                    dis = square_name(fr, fc)
            s = kind + dis + ("x" if capture else "") + square_name(tr, tc)
    n = pos.make(m)
    if n.in_check(n.turn):
        s += "#" if not n.legal_moves() else "+"
    return s


# ---------------------------------------------------------------- 화면

BG = "#16132B"
PANEL = "#221E3D"
CARD = "#2F2A52"
TEXT = "#F3F1FF"
MUTED = "#9F9AC8"
ACCENT = "#7C5CFF"
DANGER = "#FF5C7A"
GOLD = "#FFC94D"
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

SHOW_OP = sys.platform != "darwin"  # 맥 버전에서는 방장 사기 모드 관련 표시를 숨김

TIME_MODES = {  # 키: (표시 이름, (기본 시간 초, 수당 추가 초)) / None = 무제한
    "unlimited": ("무제한", None),
    "blitz": ("10분", (600, 0)),
    "incr": ("3분+2초", (180, 2)),
}


def fmt_clock(sec):
    sec = max(sec, 0)
    if sec < 10:
        return f"0:{sec:04.1f}"
    m, s = divmod(int(sec), 60)
    return f"{m}:{s:02d}"


class ChessApp:
    LIGHT, DARK = "#EEEBFF", "#8F7FE0"
    ANIM_MS = 200  # 기물 이동 애니메이션 시간
    UNDO_LIMIT = 2  # 컴퓨터 대전이 아니면 한 판에 무르기 기회 (사람마다)

    def __init__(self, root, parent=None, preset=None, on_back=None):
        """parent/preset/on_back은 미니게임룸에서 열 때 사용 (단독 실행이면 생략)."""
        self.root = root
        self.alive = True
        setup_fonts(root)
        host = parent or root
        if parent is None:
            root.title("체스")
            root.configure(bg=BG)
            root.protocol("WM_DELETE_WINDOW", self.on_close)
            root.minsize(760, 520)
        board_px = max(480, min(int(root.winfo_screenheight() * 0.72), 880))
        self.nick = (preset or {}).get("name") or "나"
        self.my_avatar = (preset or {}).get("avatar")
        self.opp_avatar = None
        self.on_result = (preset or {}).get("on_result")  # 미니게임룸: 누적 랭킹 기록
        self.result = None  # 게임 결과 카드 (None이면 안 보임)
        self.fx_bubbles, self.teabag, self.fx_on, self.last_emote = {}, None, False, 0.0
        self.opp_name = None

        self.color_var = tk.StringVar(value="w")
        self.mode_var = tk.StringVar(value="ai")
        self.time_var = tk.StringVar(value="unlimited")
        self.op_var = tk.BooleanVar(value=False)  # 방장 사기 모드
        self.super_color = None

        self.surface = ui_kit.Surface(host)  # 창 전체 배경
        self.surface.pack(fill="both", expand=True)
        host = self.surface
        panel = ui_kit.Surface(host, width=300)
        panel.pack(side="right", fill="y", padx=(0, 16), pady=16)
        panel.pack_propagate(False)
        self.panel = panel
        panel.bind("<Configure>", lambda e: self.fit_panel(), add="+")
        self.canvas = tk.Canvas(host, bg=BG, highlightthickness=0, width=board_px, height=board_px)
        self.canvas.pack(side="left", fill="both", expand=True, padx=16, pady=16)
        self.canvas.bind("<Configure>", lambda e: self.draw())
        self.canvas.bind("<Button-1>", self.on_click)
        self.result_hits = []  # 결과 카드 버튼 영역 (x0, y0, x1, y1, 할 일)

        # 설정
        card = ui_kit.Card(panel)
        card.pack(fill="x")
        self.settings_card = card
        card = card.body
        self.flipped = False  # 판 돌리기 (내 기본 방향에서 뒤집어 보기)
        top_row = tk.Frame(card, bg=PANEL)
        top_row.pack(fill="x", padx=12, pady=(12, 0))
        if on_back:  # 설정은 메뉴 화면에서 정함
            self._button(top_row, "←  메뉴로", on_back, CARD).pack(side="left", fill="x", expand=True)
        self._button(top_row, "⟲  판 돌리기", self.flip_board, CARD).pack(side="left", fill="x", expand=True,
                                                                        padx=(6 if on_back else 0, 0))
        if not on_back:
            self._segment(card, "내 색", self.color_var, [("w", "백"), ("b", "흑")])
            self._segment(card, "상대", self.mode_var, [("ai", "컴퓨터"), ("pvp", "2인"), ("net", "네트워크")])
            self._segment(card, "시간", self.time_var, [(k, v[0]) for k, v in TIME_MODES.items()])
            tk.Label(card, text="설정을 바꾼 뒤 '새 게임'을 누르세요", bg=PANEL, fg=MUTED,
                     font=(UI_FONT, 8)).pack(anchor="w", padx=12, pady=(8, 0))
        btns = tk.Frame(card, bg=PANEL)
        btns.pack(fill="x", padx=12, pady=(6, 12))
        self._button(btns, "새 게임", self.new_game, ACCENT).pack(side="left", fill="x", expand=True)
        self.undo_btn = self._button(btns, "무르기", self.undo, CARD)
        self.undo_btn.pack(side="left", fill="x", expand=True, padx=(6, 0))
        self._button(btns, "항복", self.resign, DANGER).pack(side="left", fill="x", expand=True, padx=(6, 0))

        # 시계, 상태, 기보
        self.top_clock = self._clock_card(panel)
        self.top_clock["frame"].pack(fill="x", pady=(14, 0))
        self.status_card = ui_kit.Card(panel, radius=16)
        self.status_card.pack(fill="x", pady=(10, 8))
        self.status = tk.Label(self.status_card.body, bg=PANEL, fg=TEXT, font=(UI_FONT, 11, BOLD), anchor="w",
                               justify="left", wraplength=262)
        self.status.pack(fill="x", padx=4, pady=2)
        self.people_card = ui_kit.PeopleCard(panel, UI_FONT, BOLD)  # 네트워크 대전: 참가자 현황
        self.bottom_clock = self._clock_card(panel)
        self.bottom_clock["frame"].pack(side="bottom", fill="x")
        self.popups = []  # 떠 있는 스티커 팝업
        self.chat_panel = None
        if chat is not None:
            chat_card = ui_kit.Card(panel)
            chat_card.pack(side="bottom", fill="x", pady=(0, 10))
            self.chat_panel = chat.ChatPanel(chat_card.body, (PANEL, CARD, TEXT, MUTED, ACCENT), UI_FONT, BOLD,
                                             self.send_chat, self.send_sticker, lines=4)
            self.chat_panel.pack(fill="x")
        moves_card = ui_kit.Card(panel, stretch=True)
        moves_card.pack(fill="both", expand=True, pady=(0, 10))
        self.moves_card = moves_card
        self.moves_text = tk.Text(moves_card.body, bg=PANEL, fg=TEXT, font=(MONO_FONT, 11), relief="flat", bd=0,
                                  padx=6, pady=4, wrap="none", cursor="arrow", highlightthickness=0, height=3)
        self.moves_text.pack(fill="both", expand=True)
        self.moves_text.tag_configure("num", foreground=MUTED)
        self.moves_text.tag_configure("last", foreground="#FF8FB1", font=(MONO_FONT, 11, "bold"))
        self.moves_text.config(state="disabled")

        self.conn = None  # 네트워크 상대(플레이어)와의 소켓
        self.server = None
        self.specs = []  # 방장: 관전자들 [{"conn", "name"}]
        self.pending = set()  # 방장: 들어왔지만 아직 플레이어/관전 여부를 안 밝힌 연결
        self.spectating = False  # 나는 관전자
        self.spec_count = 0
        self.spec_names = []  # 관전자 이름 (방장이 알려 줌)
        self.watch_names, self.watch_avatars = {}, {}
        self.net_ready = False  # 호스트가 정한 색/시간을 받았는지
        self.net_queue = queue.Queue()  # 통신 스레드 -> 화면 스레드
        self.piece_images = {}  # (기물, 색, 크기) -> PhotoImage
        self.anim = None  # 진행 중인 이동 애니메이션
        self.root.after(100, self.poll_net)
        self.root.after(100, self.tick)

        if preset:
            self.apply_preset(preset)
        else:
            self.new_game()

    def apply_preset(self, preset):
        self.color_var.set(preset.get("color", "w"))
        self.time_var.set(preset.get("time", "unlimited"))
        self.op_var.set(bool(preset.get("op")))
        self.mode_var.set(preset.get("mode", "ai"))
        if preset.get("mode") != "net":
            self.new_game()
            return
        self.player = self.color_var.get()
        self.mode = "net"
        self.super_color = None
        self.reset_board()
        if preset.get("net") in ("join", "watch"):
            self.join(preset.get("ip", ""), spectate=preset.get("net") == "watch")
        else:
            self.host()

    def shutdown(self):
        """미니게임룸에서 화면을 떠날 때: 반복 작업과 연결을 정리."""
        self.alive = False
        self.close_net()

    # ---- 위젯 도우미
    def _segment(self, parent, label, var, options):
        row = tk.Frame(parent, bg=PANEL)
        row.pack(fill="x", padx=12, pady=(10, 0))
        tk.Label(row, text=label, bg=PANEL, fg=MUTED, font=(UI_FONT, 9)).pack(anchor="w")
        seg = tk.Frame(row, bg=PANEL)
        seg.pack(fill="x", pady=(3, 0))
        ui_kit.segment(seg, var, options, (UI_FONT, 10, BOLD))

    @staticmethod
    def _button(parent, text, command, bg, on_bg=PANEL):
        return ui_kit.RoundButton(parent, text, command, bg=bg, font=(UI_FONT, 10, BOLD), on_bg=on_bg, pady=7)

    @staticmethod
    def _clock_card(parent):
        card = ui_kit.Card(parent, fill=CARD, radius=18, pad=4)
        f = card.body
        pic = tk.Canvas(f, width=36, height=36, bg=CARD, highlightthickness=0)
        if avatars is not None:
            pic.pack(side="left", padx=(10, 0), pady=8)
        name = tk.Label(f, bg=CARD, fg=TEXT, font=(UI_FONT, 10, BOLD), anchor="w")
        name.pack(side="left", padx=10, pady=10)
        t = tk.Label(f, bg=CARD, fg=TEXT, font=(NUM_FONT, 22, BOLD), anchor="e")
        t.pack(side="right", padx=12)
        return {"frame": card, "name": name, "time": t, "pic": pic}

    def avatar_for(self, color):
        if self.spectating:
            return avatars.valid(self.watch_avatars.get(color)) or avatars.default_avatar(0 if color == "w" else 1)
        if self.mode == "pvp":
            return avatars.default_avatar(0 if color == "w" else 1)
        if color == self.player:
            return self.my_avatar
        return avatars.robot_avatar() if self.mode == "ai" else self.opp_avatar

    def draw_clock_avatars(self):
        if avatars is None:
            return
        for card, color in ((self.bottom_clock, self.player), (self.top_clock, opponent(self.player))):
            pic = card["pic"]
            pic.delete("all")
            avatars.draw_avatar(pic, 18, 18, 34, self.avatar_for(color) or avatars.default_avatar(1))

    # ---- 게임 진행
    def new_game(self):
        if self.spectating:
            return
        if self.mode_var.get() == "net":
            if self.conn:
                self.send({"type": "new", "time": self.time_var.get(), "super": self.super_color})
                self.reset_board()
            else:
                self.open_net_dialog()
            return
        self.close_net()
        self.player = self.color_var.get()
        self.mode = self.mode_var.get()
        self.super_color = None
        self.reset_board()

    def reset_board(self):
        self.history = [Position(super_color=self.super_color)]
        self.last_moves = [None]
        self.sans = [None]
        self.selected = None
        self.targets = {}
        self.game_over = False
        self.thinking = False
        self.flag_text = None  # 시간 초과 결과
        self.time_ctrl = TIME_MODES[self.time_var.get()][1]
        base = self.time_ctrl[0] if self.time_ctrl else 0
        self.clock = {"w": float(base), "b": float(base)}
        if self.super_color:
            self.clock[self.super_color] *= 2  # 방장은 시간 2배
        self.clock_hist = [dict(self.clock)]
        self.undos_left = {"w": self.UNDO_LIMIT, "b": self.UNDO_LIMIT}
        self.undo_pending = False  # 네트워크: 무르기 요청 후 답을 기다리는 중
        self.turn_started = None  # 첫 수를 둔 뒤부터 시계가 돎
        self.anim = None
        self.game_id = getattr(self, "game_id", 0) + 1
        self.result = None
        self.refresh()
        self.schedule_ai()

    @property
    def pos(self):
        return self.history[-1]

    def is_ai_turn(self):
        return self.mode == "ai" and not self.game_over and self.pos.turn != self.player

    def push(self, move, remote_clock=None):
        mover = self.pos.turn
        if self.time_ctrl:
            if self.turn_started is not None:
                self.clock[mover] -= time.monotonic() - self.turn_started
            self.clock[mover] += self.time_ctrl[1]
            if remote_clock is not None:
                self.clock[mover] = remote_clock
        if self.mode == "net" and remote_clock is None:
            self.send({"type": "move", "move": list(move), "clock": self.clock[mover]})
        self.start_anim(self.pos, move)
        self.sans.append(move_san(self.pos, move))
        self.history.append(self.pos.make(move))
        self.last_moves.append(move)
        self.clock_hist.append(dict(self.clock))
        self.turn_started = time.monotonic()
        self.selected = None
        self.targets = {}
        self.refresh()
        if self.game_over:
            text = self.status["text"]
            if party is not None:
                gid = self.game_id
                self.root.after(self.ANIM_MS + 80, lambda: gid == self.game_id and self.open_result())
            else:
                self.root.after(self.ANIM_MS + 80, lambda: messagebox.showinfo("게임 종료", text))
        else:
            self.schedule_ai()

    def schedule_ai(self):
        if self.is_ai_turn():
            self.thinking = True
            self.status.config(text="컴퓨터가 생각 중...")
            gid = self.game_id
            self.root.after(self.ANIM_MS + 60, lambda: self.ai_move(gid))  # 애니메이션이 끝난 뒤 계산

    def ai_move(self, gid):
        if not self.alive or gid != self.game_id or not self.is_ai_turn():
            return
        move = best_move(self.pos)
        self.thinking = False
        if gid == self.game_id and not self.game_over:
            self.push(move)

    def undo(self):
        if self.thinking or len(self.history) <= 1 or self.spectating:
            return
        if self.mode == "ai":  # 컴퓨터 대전은 무제한 (내 차례까지 되돌림)
            self._pop()
            while len(self.history) > 1 and self.pos.turn != self.player:
                self._pop()
            self._after_undo()
            return
        mover = opponent(self.pos.turn)  # 방금 둔 사람
        if self.mode == "net":
            if not (self.conn and self.net_ready) or self.undo_pending:
                return
            if self.game_over or mover != self.player:
                self.note("내가 방금 둔 수만, 상대가 두기 전에 무를 수 있어요")
                return
        if self.undos_left[mover] <= 0:
            self.note(f"무르기 기회를 다 썼어요 (한 판에 {self.UNDO_LIMIT}번)")
            return
        if self.mode == "net":
            self.undo_pending = True
            self.send({"type": "undo_req", "n": len(self.history)})
            self.status.config(text="무르기 요청 중...")
            return
        self.undos_left[mover] -= 1
        self._pop()
        self._after_undo()
        self.note(f"{'백' if mover == 'w' else '흑'} 무르기 (남은 기회 {self.undos_left[mover]}번)")

    def on_undo_req(self, n):
        """상대가 방금 둔 수를 무르자고 함: 내가 아직 안 뒀으면 받아 줌."""
        mover = opponent(self.pos.turn)
        ok = (not self.game_over and n == len(self.history) and len(self.history) > 1 and mover != self.player
              and self.undos_left[mover] > 0)
        if ok:
            self.undos_left[mover] -= 1
            self._pop()
            self._after_undo()
            self.note(f"상대가 한 수 물렀어요 (남은 기회 {self.undos_left[mover]}번)")
        self.send({"type": "undo_ok" if ok else "undo_no"})

    def on_undo_answer(self, ok):
        if not self.undo_pending:
            return
        self.undo_pending = False
        if ok:
            self.undos_left[self.player] -= 1
            self._pop()
            self._after_undo()
            self.note(f"한 수 물렀어요 (남은 기회 {self.undos_left[self.player]}번)")
        else:
            self.note("상대가 이미 둬서 무를 수 없어요")
            self.refresh()

    def _after_undo(self):
        self.clock = dict(self.clock_hist[-1])
        self.turn_started = time.monotonic() if len(self.history) > 1 else None
        self.selected = None
        self.targets = {}
        self.flag_text = None
        self.anim = None
        self.result = None
        self.refresh()
        self.schedule_ai()

    def note(self, text):
        """짧은 알림: 채팅 칸에 회색 글씨로."""
        if self.chat_panel:
            self.chat_panel.add("", text, system=True)
        else:
            self.status.config(text=text)

    def flip_board(self):
        self.flipped = not self.flipped
        self.selected, self.targets = None, {}
        self.draw()

    def _pop(self):
        for lst in (self.history, self.last_moves, self.sans, self.clock_hist):
            lst.pop()

    # ---- 시계
    def remaining(self, color):
        c = self.clock[color]
        if self.turn_started is not None and not self.game_over and self.pos.turn == color:
            c -= time.monotonic() - self.turn_started
        return c

    def tick(self):
        if not self.alive:
            return
        if self.time_ctrl and self.turn_started is not None and not self.game_over:
            color = self.pos.turn
            # 네트워크에서는 상대의 시간 초과를 상대 쪽 알림으로 확정 (지연 차이 방지)
            if self.remaining(color) <= 0 and not (self.mode == "net" and (color != self.player or self.spectating)):
                self.flag(color)
        self.update_clocks()
        self.root.after(100, self.tick)

    def resign(self):
        if self.game_over or self.spectating or (self.mode == "net" and not (self.conn and self.net_ready)):
            return
        color = self.player if self.mode in ("ai", "net") else self.pos.turn
        if messagebox.askyesno("항복", f"{self.player_name(color)} 항복할까요?"):
            self.do_resign(color)

    def do_resign(self, color, notify=True):
        if self.game_over or color not in ("w", "b"):
            return
        loser, winner = ("백", "흑") if color == "w" else ("흑", "백")
        self.flag_text = f"{loser} 항복! {winner} 승리"  # 시간 초과처럼 결과를 고정
        self.thinking = False
        self.game_id += 1  # 진행 중이던 컴퓨터 계산 무시
        if self.mode == "net" and notify:
            self.send({"type": "resign", "color": color})
        self.refresh()
        if party is not None:
            self.open_result()
        else:
            messagebox.showinfo("게임 종료", self.flag_text)

    def flag(self, color, notify=True):
        self.clock[color] = 0
        winner = "흑" if color == "w" else "백"
        self.flag_text = f"시간 초과! {winner} 승리"
        if self.mode == "net" and notify:
            self.send({"type": "timeout", "color": color})
        self.refresh()
        if party is not None:
            self.open_result()
        else:
            messagebox.showinfo("게임 종료", self.flag_text)

    def update_clocks(self):
        for card, color in ((self.bottom_clock, self.player), (self.top_clock, opponent(self.player))):
            active = not self.game_over and self.pos.turn == color
            if self.time_ctrl:
                rem = self.remaining(color)
                text = fmt_clock(rem)
                low = rem < 20
            else:
                text, low = "--:--", False
            bg = "#F2F2EE" if active else CARD
            fg = (DANGER if low else BG) if active else (DANGER if low else MUTED)
            card["frame"].config(bg=bg)
            card["pic"].config(bg=bg)
            card["name"].config(bg=bg, fg=BG if active else TEXT)
            card["time"].config(bg=bg, fg=fg, text=text)

    def player_name(self, color):
        side = "백" if color == "w" else "흑"
        if SHOW_OP and color == self.super_color:
            side += " ★"
        if self.spectating:
            return f"{self.watch_names.get(color) or '?'} · {side}"
        if self.mode == "pvp":
            return f"{side} 플레이어"
        if color == self.player:
            return f"{self.nick} · {side}"
        return f"{'컴퓨터' if self.mode == 'ai' else (self.opp_name or '상대')} · {side}"

    # ---- 상태 표시
    def refresh(self):
        pos = self.pos
        side = "백" if pos.turn == "w" else "흑"
        moves = pos.legal_moves()
        check = pos.in_check(pos.turn)
        repeats = sum(1 for p in self.history if p.key() == pos.key())
        self.game_over = True
        if self.flag_text:
            text = self.flag_text
        elif not moves and check:
            winner = "흑" if pos.turn == "w" else "백"
            text = f"체크메이트! {winner} 승리"
        elif not moves:
            text = "스테일메이트 - 무승부"
        elif pos.insufficient_material():
            text = "기물 부족 - 무승부"
        elif pos.halfmove >= 100:
            text = "50수 규칙 - 무승부"
        elif repeats >= 3:
            text = "3회 동형 반복 - 무승부"
        else:
            self.game_over = False
            text = f"{side} 차례" + ("  ·  체크!" if check else "")
        if SHOW_OP and self.super_color:
            text += "\n★ 방장 사기 모드 - 방장 기물은 나이트 점프 가능, 시간 2배"
        if self.spectating:
            text = "관전 중  ·  " + text
        if self.game_over:
            self.turn_started = None
        self.status.config(text=text, fg=DANGER if check or self.game_over else TEXT)
        self.top_clock["name"].config(text=self.player_name(opponent(self.player)))
        self.draw_clock_avatars()
        self.bottom_clock["name"].config(text=self.player_name(self.player))
        self.update_clocks()
        self.update_people()
        if self.mode == "ai" or self.spectating:
            self.undo_btn.config(text="무르기")
        else:
            who = self.player if self.mode == "net" else opponent(self.pos.turn)
            self.undo_btn.config(text=f"무르기 {self.undos_left[who]}")
        self.render_moves()
        self.draw()
        if self.specs:
            self.send_specs(self.snapshot())

    def update_people(self):
        """네트워크 대전일 때 오른쪽에 플레이어와 관전자 목록."""
        if self.mode != "net":
            self.people_card.pack_forget()
            return
        turn = self.pos.turn
        players = []
        for color in ("w", "b"):
            name = self.player_name(color).rsplit(" · ", 1)[0]
            mine = not self.spectating and color == self.player
            badge = ("백" if color == "w" else "흑") + ("  ·  차례" if turn == color and not self.game_over else "")
            players.append((self.avatar_for(color), name + ("  (나)" if mine else ""), badge,
                            turn == color and not self.game_over))
        specs = [x["name"] for x in self.specs] if self.specs else list(self.spec_names)
        if self.spectating and self.nick not in specs:
            specs.append(self.nick)
        if self.people_card.mode and not self.people_card.winfo_ismapped():
            self.people_card.pack(fill="x", pady=(0, 8), after=self.status_card)
        self.people_card.update_people(players, specs)
        self.fit_panel()

    def fit_panel(self):
        """창이 낮으면 기보 -> 참가자 -> 채팅 순서로 줄여서 오른쪽 칸이 넘치지 않게."""
        def run():
            if not self.alive:
                return
            ui_kit.fit_side_panel(
                self.panel, self.people_card if self.mode == "net" else None,
                lambda: self.people_card.pack(fill="x", pady=(0, 8), after=self.status_card), self.chat_panel,
                extra=self.moves_card, extra_pack=lambda: self.moves_card.pack(fill="both", expand=True, pady=(0, 10)))
        ui_kit.schedule(self.panel, "fit", run)

    def specs_msg(self):
        return {"type": "specs", "n": len(self.specs), "names": [x["name"] for x in self.specs][:20]}

    def render_moves(self):
        t = self.moves_text
        t.config(state="normal")
        t.delete("1.0", "end")
        sans = self.sans[1:]
        for i in range(0, len(sans), 2):
            t.insert("end", f"{i // 2 + 1:>3}. ", "num")
            for j in (i, i + 1):
                if j < len(sans):
                    t.insert("end", f" {sans[j]} ", "last" if j == len(sans) - 1 else ())
                    t.insert("end", " " * max(8 - len(sans[j]), 1))
            t.insert("end", "\n")
        t.config(state="disabled")
        t.see("end")

    # ---- 입력
    def on_click(self, event):
        if self.result:  # 결과 카드가 떠 있으면 카드 버튼만
            for x0, y0, x1, y1, action in self.result_hits:
                if x0 <= event.x <= x1 and y0 <= event.y <= y1:
                    action()
                    return
            return
        if self.game_over or self.thinking or self.is_ai_turn():
            return
        if self.mode == "net" and (self.spectating or self.conn is None or not self.net_ready or
                                   self.pos.turn != self.player):
            return
        sq = self.sq
        dc, dr = (event.x - self.ox) // sq, (event.y - self.oy) // sq
        if not (0 <= dr < 8 and 0 <= dc < 8):
            return
        r, c = self.to_board(dr, dc)
        if (r, c) in self.targets:
            moves = self.targets[(r, c)]
            move = moves[0]
            if len(moves) > 1:  # 프로모션
                promo = self.ask_promotion()
                move = next(m for m in moves if m[4] == promo)
            self.push(move)
            return
        p = self.pos.board[r][c]
        if p and p[0] == self.pos.turn and self.selected != (r, c):
            self.selected = (r, c)
            self.targets = {}
            for m in self.pos.legal_moves():
                if (m[0], m[1]) == (r, c):
                    self.targets.setdefault((m[2], m[3]), []).append(m)
        else:
            self.selected = None
            self.targets = {}
        self.draw()

    def ask_promotion(self):
        color = self.pos.turn
        win = tk.Toplevel(self.root, bg=PANEL)
        win.title("승진")
        win.resizable(False, False)
        win.transient(self.root)
        choice = tk.StringVar(value="Q")
        tk.Label(win, text="승진할 기물을 고르세요", bg=PANEL, fg=TEXT,
                 font=(UI_FONT, 11, BOLD)).pack(padx=14, pady=(12, 6))
        row = tk.Frame(win, bg=PANEL)
        row.pack(padx=14, pady=(0, 14))
        for kind in "QRBN":
            cell = tk.Canvas(row, width=72, height=72, bg=self.LIGHT, highlightthickness=0, cursor="hand2")
            cell.pack(side="left", padx=3)
            self.place_piece(cell, kind, color, 36, 36, 72)
            cell.bind("<Button-1>", lambda e, k=kind: (choice.set(k), win.destroy()))
        win.grab_set()
        self.root.wait_window(win)
        return choice.get()

    # ---- 네트워크 (같은 와이파이)
    def open_net_dialog(self):
        win = tk.Toplevel(self.root, bg=PANEL)
        win.title("네트워크 대전")
        win.resizable(False, False)
        win.transient(self.root)
        font = (UI_FONT, 10)
        color = "백" if self.color_var.get() == "w" else "흑"
        lbl = {"bg": PANEL, "fg": TEXT}
        tk.Label(win, text=f"내 IP: {local_ip()}   (포트 {PORT})", font=(UI_FONT, 12, BOLD), **lbl).pack(
            padx=18, pady=(16, 2))
        tk.Label(win, text=f"방을 만들면 {color} · {TIME_MODES[self.time_var.get()][0]} 으로 시작합니다",
                 font=font, bg=PANEL, fg=MUTED).pack(padx=18)
        if SHOW_OP:
            op = tk.Label(win, bg=PANEL, font=(UI_FONT, 10, BOLD), cursor="hand2")
            op.pack(padx=18, pady=(10, 0))
            paint_op = lambda *_: op.config(text=("☑" if self.op_var.get() else "☐") + "  ★ 방장 사기 모드 (재미용)",
                                            fg=ACCENT if self.op_var.get() else TEXT)
            op.bind("<Button-1>", lambda e: (self.op_var.set(not self.op_var.get()), paint_op()))
            paint_op()
            tk.Label(win, text="방장 기물(킹 제외)이 나이트처럼 점프도 가능 · 방장 시간 2배", font=(UI_FONT, 9),
                     bg=PANEL, fg=MUTED).pack(padx=18)
        self._button(win, "방 만들기", lambda: (win.destroy(), self.host()), ACCENT).pack(
            fill="x", padx=18, pady=(8, 16))
        tk.Label(win, text="상대 PC의 IP로 참가", font=font, **lbl).pack()
        entry = tk.Entry(win, width=22, justify="center", font=(MONO_FONT, 12), relief="flat")
        entry.pack(padx=18, pady=6, ipady=4)
        entry.focus_set()
        def join():
            ip = entry.get().strip()  # 창을 닫기 전에 읽어야 함
            win.destroy()
            self.join(ip)

        entry.bind("<Return>", lambda e: join())
        self._button(win, "참가하기", join, CARD).pack(fill="x", padx=18, pady=(2, 18))

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
        self.status.config(text=f"상대를 기다리는 중...\n내 IP: {local_ip()}", fg=TEXT)
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
        self.status.config(text=f"{ip} 에 접속하는 중...", fg=TEXT)
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
            pass  # 끊김은 _reader가 알려줌

    def send_specs(self, obj, exclude=None):
        for x in self.specs:
            if x["conn"] is not exclude:
                self.send_to(x["conn"], obj)

    def snapshot(self):
        """관전자에게 보내는 지금 판 전체."""
        me, opp = self.player, opponent(self.player)
        return {"type": "snapshot", "moves": [list(m) for m in self.last_moves[1:]],
                "names": {me: self.nick, opp: self.opp_name or "상대"},
                "avatars": {me: self.my_avatar, opp: self.opp_avatar},
                "time": self.time_var.get(), "clock": {c: self.remaining(c) for c in "wb"},
                "running": self.turn_started is not None and not self.game_over, "super": self.super_color,
                "flag_text": self.flag_text, "specs": len(self.specs),
                "spec_names": [x["name"] for x in self.specs][:20]}

    def apply_snapshot(self, s):
        """관전자: 받은 판으로 화면을 맞춤 (한 수만 늘었으면 이동 애니메이션)."""
        self.spectating, self.mode, self.player, self.net_ready = True, "net", "w", True
        self.watch_names = s.get("names", {})
        self.watch_avatars = s.get("avatars", {})
        self.spec_count = s.get("specs", 0)
        self.spec_names = ui_kit.clean_names(s.get("spec_names"))
        self.super_color = s.get("super")
        if s.get("time") in TIME_MODES:
            self.time_var.set(s["time"])
            self.time_ctrl = TIME_MODES[s["time"]][1]
        moves = [tuple(m) for m in s.get("moves", [])]
        cur = self.last_moves[1:]
        if moves[:len(cur)] == cur and len(moves) == len(cur) + 1:
            m = moves[-1]
            self.start_anim(self.pos, m)
            self.sans.append(move_san(self.pos, m))
            self.history.append(self.pos.make(m))
            self.last_moves.append(m)
            self.clock_hist.append(dict(self.clock))
        elif moves != cur:
            self.history, self.last_moves, self.sans = [Position(super_color=self.super_color)], [None], [None]
            for m in moves:
                self.sans.append(move_san(self.pos, m))
                self.history.append(self.pos.make(m))
                self.last_moves.append(m)
            self.clock_hist = [dict(self.clock)] * len(self.history)
            self.anim = None
            if len(moves) < len(cur):
                self.result = None
        self.clock = {c: float(v) for c, v in s.get("clock", {"w": 0, "b": 0}).items()}
        self.turn_started = time.monotonic() if s.get("running") else None
        was_over = self.game_over
        self.flag_text = s.get("flag_text")
        self.refresh()
        if self.game_over and not was_over and party is not None:
            gid = self.game_id
            self.root.after(self.ANIM_MS + 80, lambda: gid == self.game_id and self.open_result())
        if not self.game_over:
            self.result = None

    def poll_net(self):
        if not self.alive:
            return
        while not self.net_queue.empty():
            kind, conn, data = self.net_queue.get()
            if kind == "error":
                self.status.config(text=data, fg=DANGER)
                messagebox.showerror("네트워크", data)
            elif kind == "incoming":  # 방장: 새 연결 -> 'join'으로 플레이어/관전을 밝힐 때까지 대기
                if self.server is None:
                    conn.close()
                    continue
                self.pending.add(conn)
                threading.Thread(target=self._reader, args=(conn,), daemon=True).start()
            elif kind == "connected":  # 참가자/관전자: 방장에게 연결됨
                self.conn = conn
                self.mode = "net"
                self.net_ready = False
                threading.Thread(target=self._reader, args=(conn,), daemon=True).start()
                self.send({"type": "join", "role": "spectator" if getattr(self, "want_spectate", False) else "player",
                           "name": self.nick, "avatar": self.my_avatar})
                self.status.config(text="연결됨 - 방장 응답 대기...", fg=TEXT)
            elif conn in self.pending:
                self.on_join(conn, data if kind == "msg" else None)
            elif any(x["conn"] is conn for x in self.specs):
                self.on_spec_msg(conn, kind, data)
            elif conn is not self.conn:
                continue  # 이전 연결에서 온 메시지
            elif kind == "closed":
                self.conn = None
                self.status.config(text="상대와 연결이 끊어졌습니다", fg=DANGER)
                messagebox.showwarning("네트워크", "상대와 연결이 끊어졌습니다.")
            elif data.get("type") == "snapshot":
                self.apply_snapshot(data)
            elif data.get("type") == "specs":
                self.spec_count = int(data.get("n", 0))
                self.spec_names = ui_kit.clean_names(data.get("names"))
                self.refresh()
            elif data.get("type") == "start":
                self.spectating = False
                self.opp_name = data.get("name")
                self.opp_avatar = avatars.valid(data.get("avatar")) if avatars else None
                self.send({"type": "hello", "name": self.nick, "avatar": self.my_avatar})
                self.net_ready = True
                self.player = data["color"]
                self.super_color = data.get("super")
                self.color_var.set(self.player)
                self.time_var.set(data.get("time", "unlimited"))
                self.reset_board()
            elif data.get("type") == "hello":
                self.opp_name = str(data.get("name", ""))[:12] or None
                self.opp_avatar = avatars.valid(data.get("avatar")) if avatars else None
                self.refresh()
            elif data.get("type") == "new":
                self.time_var.set(data.get("time", "unlimited"))
                self.super_color = data.get("super")
                self.reset_board()
            elif data.get("type") == "undo_req":
                self.on_undo_req(data.get("n"))
            elif data.get("type") in ("undo_ok", "undo_no"):
                self.on_undo_answer(data.get("type") == "undo_ok")
            elif data.get("type") == "move":
                move = tuple(data["move"])
                if self.pos.turn != self.player and move in self.pos.legal_moves():
                    self.push(move, remote_clock=data.get("clock", 0.0))
            elif data.get("type") == "chat" and self.chat_panel:
                name = str(data.get("name") or self.opp_name or "상대")[:12]
                text = str(data.get("text", ""))[:chat.MAX_TEXT]
                self.chat_panel.add(name, text, "#3DDC97")
                if self.specs:  # 방장: 플레이어 채팅을 관전자에게
                    self.send_specs({"type": "chat", "name": name, "text": text})
            elif data.get("type") == "sticker" and chat and data.get("id") in chat.STICKER_IDS:
                name = str(data.get("name") or self.opp_name or "상대")[:12]
                self.show_sticker(data["id"], name)
                if self.specs:
                    self.send_specs({"type": "sticker", "id": data["id"], "name": name})
            elif data.get("type") == "emote":
                self.apply_emote(data.get("color"), data.get("text"), bool(data.get("teabag")))
                if self.specs:
                    self.send_specs(data)
            elif data.get("type") == "resign":
                self.do_resign(data.get("color"), notify=False)
            elif data.get("type") == "timeout" and not self.game_over:
                self.flag(data["color"], notify=False)
        self.root.after(100, self.poll_net)

    def on_join(self, conn, data):
        """방장: 새로 들어온 연결이 플레이어인지 관전자인지 정함."""
        self.pending.discard(conn)
        if not data or data.get("type") != "join":
            return
        name = str(data.get("name", "손님"))[:12]
        av = avatars.valid(data.get("avatar")) if avatars else None
        if data.get("role") == "player" and self.conn is None:
            self.conn = conn
            self.net_ready = True
            self.opp_name, self.opp_avatar = name, av
            self.player = self.color_var.get()
            self.super_color = self.player if self.op_var.get() else None
            self.send({"type": "start", "color": opponent(self.player), "time": self.time_var.get(),
                       "super": self.super_color, "name": self.nick, "avatar": self.my_avatar})
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
        self.specs, self.pending = [], set()

    def on_close(self):
        self.close_net()
        self.root.destroy()

    # ---- 그리기
    def to_board(self, dr, dc):
        flip = (self.player == "b") != self.flipped  # 흑이면 기본으로 뒤집고, 판 돌리기로 한 번 더
        return (7 - dr, 7 - dc) if flip else (dr, dc)

    def square_center(self, r, c):
        dr, dc = self.to_board(r, c)  # 뒤집기는 양방향이 같음
        return self.ox + (dc + 0.5) * self.sq, self.oy + (dr + 0.5) * self.sq

    def place_piece(self, cv, kind, color, cx, cy, size, tags=()):
        if Image is None:
            draw_piece(cv, kind, color, cx, cy, size, tags)
            return
        key = (kind, color, size)
        if key not in self.piece_images:
            if size == getattr(self, "sq", None) and len(self.piece_images) > 24:
                self.piece_images = {k: v for k, v in self.piece_images.items() if k[2] == size}
            self.piece_images[key] = ImageTk.PhotoImage(render_piece(kind, color, size))
        cv.create_image(cx, cy, image=self.piece_images[key], anchor="center", tags=tags)

    def start_anim(self, before, move):
        fr, fc, tr, tc, _ = move
        piece = before.board[fr][fc]
        moving = [((fr, fc), (tr, tc), piece)]
        if piece[1] == "K" and abs(tc - fc) == 2:  # 캐슬링: 룩도 같이 이동
            rook_from, rook_to = (tr, 7 if tc == 6 else 0), (tr, 5 if tc == 6 else 3)
            moving.append((rook_from, rook_to, before.board[rook_from[0]][rook_from[1]]))
        self.anim = {"moving": moving, "captured": before.board[tr][tc], "t0": time.monotonic()}
        self.root.after(15, self.anim_step)

    def anim_progress(self):
        t = min((time.monotonic() - self.anim["t0"]) * 1000 / self.ANIM_MS, 1.0)
        return 1 - (1 - t) ** 3  # 끝에서 부드럽게 감속

    def draw_moving(self):
        cv = self.canvas
        cv.delete("anim")
        e = self.anim_progress()
        for (fr, fc), (tr, tc), piece in self.anim["moving"]:
            x0, y0 = self.square_center(fr, fc)
            x1, y1 = self.square_center(tr, tc)
            self.place_piece(cv, piece[1], piece[0], x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, self.sq,
                             tags="anim")

    def anim_step(self):
        if not self.anim or not self.alive:
            return
        if self.anim_progress() >= 1:
            self.anim = None
            self.draw()
        else:
            self.draw_moving()
            self.root.after(15, self.anim_step)

    def draw(self):
        cv = self.canvas
        cv.delete("!bg")
        ui_kit.paint_backdrop(cv)
        w, h = cv.winfo_width(), cv.winfo_height()
        m = 14  # 판 둘레 받침 두께
        sq = max((min(w, h) - 2 * m - 8) // 8, 1)  # 정수 크기 -> 모든 칸이 똑같은 정사각형
        self.sq = sq
        self.ox, self.oy = (w - sq * 8) // 2, (h - sq * 8) // 2
        bx0, by0, bx1, by1 = self.ox - m, self.oy - m, self.ox + sq * 8 + m, self.oy + sq * 8 + m
        ui_kit.round_rect(cv, bx0 + 6, by0 + 10, bx1 + 6, by1 + 10, 26, "#0E0B22")  # 그림자
        ui_kit.round_rect(cv, bx0, by0, bx1, by1, 26, PANEL, outline=blend(PANEL, "#FFFFFF", 0.08), width=2)
        pos = self.pos
        last = self.last_moves[-1]
        lit = {(last[0], last[1]), (last[2], last[3])} if last else set()
        check_sq = pos.king_square(pos.turn) if pos.in_check(pos.turn) else None
        label_font = (UI_FONT, -max(int(sq * 0.15), 9), BOLD)
        anim_to = {m[1] for m in self.anim["moving"]} if self.anim else set()

        for dr in range(8):
            for dc in range(8):
                r, c = self.to_board(dr, dc)
                x0, y0 = self.ox + dc * sq, self.oy + dr * sq
                cx, cy = x0 + sq / 2, y0 + sq / 2  # 칸의 정중앙
                base = self.LIGHT if (r + c) % 2 == 0 else self.DARK
                fill = base
                if (r, c) == self.selected:
                    fill = blend(base, "#F4E34C", 0.6)
                elif (r, c) in lit:
                    fill = blend(base, "#F4E34C", 0.42)
                if (r, c) == check_sq:
                    fill = blend(base, DANGER, 0.7)
                cv.create_rectangle(x0, y0, x0 + sq, y0 + sq, fill=fill, width=0)

                text_col = self.DARK if base == self.LIGHT else self.LIGHT
                if dc == 0:
                    cv.create_text(x0 + 4, y0 + 3, text=str(8 - r), anchor="nw", fill=text_col, font=label_font)
                if dr == 7:
                    cv.create_text(x0 + sq - 4, y0 + sq - 2, text=FILES[c], anchor="se", fill=text_col,
                                   font=label_font)

                p = pos.board[r][c]
                if (r, c) in anim_to:  # 도착 전: 잡히는 기물을 잠시 남겨 둠
                    captured = self.anim["captured"] if (r, c) == self.anim["moving"][0][1] else None
                    if captured:
                        self.place_piece(cv, captured[1], captured[0], cx, cy, sq)
                elif p:
                    self.place_piece(cv, p[1], p[0], cx, cy, sq)

                if (r, c) in self.targets:
                    mark = blend(fill, "#000000", 0.22)
                    if p:
                        rad = sq * 0.47
                        cv.create_oval(cx - rad, cy - rad, cx + rad, cy + rad, outline=mark,
                                       width=max(int(sq * 0.08), 3))
                    else:
                        rad = sq * 0.16
                        cv.create_oval(cx - rad, cy - rad, cx + rad, cy + rad, fill=mark, width=0)
        rad = max(sq * 0.18, 6)  # 판 네 모서리를 둥글게
        for cx, cy, sx, sy in ((self.ox, self.oy, 1, 1), (self.ox + sq * 8, self.oy, -1, 1),
                               (self.ox, self.oy + sq * 8, 1, -1), (self.ox + sq * 8, self.oy + sq * 8, -1, -1)):
            pts = [cx, cy]
            for k in range(11):
                a = math.pi / 2 * k / 10
                pts += [cx + sx * rad * (1 - math.cos(a)), cy + sy * rad * (1 - math.sin(a))]
            cv.create_polygon(pts, fill=PANEL, outline="")
        if self.anim:
            self.draw_moving()
        self.draw_result()
        self.draw_popups()

    # ---- 게임 결과 카드: 멘트, 티배깅
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
        cv = self.canvas
        cv.delete("popup")
        if chat is None or not getattr(self, "popups", None) or not hasattr(self, "sq"):
            return
        sq = self.sq
        x = self.ox + sq * 7.3
        spots = {"me": (x, self.oy + sq * 6.9), "opp": (x, self.oy + sq * 1.1), None: (x, self.oy + sq * 4)}
        chat.draw_popups(cv, self.popups, lambda p: spots.get(p["who"], spots[None]), sq * 0.95,
                         (UI_FONT, 9, BOLD), tags="popup")

    def viewer_color(self):
        if self.mode in ("ai", "net"):
            return self.player
        return (self.result or {}).get("winner") or "w"

    def open_result(self):
        if not self.alive or not self.game_over or party is None:
            return
        pos = self.pos
        if self.flag_text:
            winner = "w" if "백 승리" in self.flag_text else "b"
        elif not pos.legal_moves() and pos.in_check(pos.turn):
            winner = opponent(pos.turn)
        else:
            winner = None
        moves = (len(self.sans) - 1 + 1) // 2
        comments = [self.status["text"].split("\n")[0]]
        if winner and not self.flag_text:
            comments.append(f"{moves}수 만에 끝!" if moves > 12 else f"단 {moves}수 만에 끝!")
        if winner and self.flag_text:
            comments.append("항복승!" if "항복" in self.flag_text else "시간 관리 실패...")
        if winner and SHOW_OP and winner == self.super_color:
            comments.append("방장 사기 모드의 힘 ㅋㅋ")
        self.result = {"winner": winner, "comments": comments, "tally": ""}
        viewer = self.viewer_color()
        kind = "draw" if winner is None else ("win" if viewer == winner else "lose")
        self.result["opts"] = [] if self.spectating else party.pick_lines(kind)
        if self.on_result and self.mode in ("ai", "net") and not self.spectating:
            me = self.nick
            opp = "컴퓨터" if self.mode == "ai" else (self.opp_name or "상대")
            names = [me, opp]
            winners = [] if winner is None else [me if winner == self.player else opp]
            tally = self.on_result("chess", names, winners)
            self.result["tally"] = "누적 우승   " + "  ·  ".join(f"{n} {tally.get(n, 0)}회" for n in names)
        self.fx_bubbles, self.teabag = {}, None
        self.draw()

    def close_result(self):
        self.result = None
        self.draw()

    def send_emote(self, text=None, teabag=False):
        now = time.monotonic()
        if not self.result or now - self.last_emote < 0.6 or self.spectating:
            return
        if teabag and (self.result["winner"] is None or self.viewer_color() != self.result["winner"]):
            return  # 진 사람은 티배깅 못 함
        self.last_emote = now
        color = self.viewer_color()
        self.apply_emote(color, text, teabag)
        if self.mode == "net":
            self.send({"type": "emote", "color": color, "text": text, "teabag": teabag})
            self.send_specs({"type": "emote", "color": color, "text": text, "teabag": teabag})
        elif self.mode == "ai":  # 컴퓨터가 받아침
            ai = opponent(self.player)
            kind = "draw" if self.result["winner"] is None else ("win" if self.result["winner"] == ai else "lose")
            gid = self.game_id
            self.root.after(1300, lambda: self.alive and gid == self.game_id and
                            self.apply_emote(ai, party.reply_line(kind)))

    def apply_emote(self, color, text=None, teabag=False):
        if not self.result or color not in ("w", "b"):
            return
        now = time.monotonic()
        if teabag and color != self.result["winner"]:
            return
        if teabag:
            self.teabag = {"actor": color, "target": opponent(color), "t0": now}
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
        popups = chat is not None and any(now - p["t0"] < chat.POPUP_TIME for p in self.popups)
        return bool(self.teabag) or popups or any(exp > now for _, exp in self.fx_bubbles.values())

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
        cv = self.canvas
        res = self.result
        if not dyn or not res:
            cv.delete("result")
        if not res or party is None:
            self.result_hits = []
            return
        winner = res["winner"]
        can_tb = bool(winner) and not self.spectating and self.viewer_color() == winner
        self.result_hits = party.draw_duel_result(
            cv, (0, 0, cv.winfo_width(), cv.winfo_height()), res, winner or "w", opponent, self.player_name,
            self._draw_result_avatar, self.teabag, self.fx_bubbles, time.monotonic(), can_tb, (UI_FONT, NUM_FONT, BOLD),
            self.close_result, lambda t: self.send_emote(text=t), lambda: self.send_emote(teabag=True),
            (GOLD, TEXT, MUTED, DANGER, CARD, BG), dyn=dyn, dim_box=(self.ox - 14, self.oy - 14, self.ox + self.sq * 8 + 14, self.oy + self.sq * 8 + 14, 26))

    def _draw_result_avatar(self, cv, x, y, size, color, tags="result"):
        if avatars is not None:
            avatars.draw_avatar(cv, x, y, size, self.avatar_for(color) or avatars.default_avatar(1), tags=tags,
                                ring="white")
        else:
            cv.create_oval(x - size / 2, y - size / 2, x + size / 2, y + size / 2,
                           fill="#F4F0E8" if color == "w" else "#2F2F2F", outline="white", width=3, tags=tags)


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
    ChessApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
