"""KI득KI득 웹 서버: 웹 화면(static/)을 보내 주고, 방 만들기 · 참가 · 채팅 · 게임 수를 웹소켓으로 이어 줌.

게임 규칙은 브라우저마다 똑같이 계산하고, 서버는 '누가 어떤 순서로 무엇을 했는지'만 정해서 모두에게 보냄.
(데스크톱판의 '방장 PC' 역할을 서버가 대신해서, 다른 와이파이 · 폰끼리도 같이 할 수 있음)

신원: 브라우저마다 비밀 열쇠(cid)를 들고 오고, 다른 사람에게는 공개 번호(pid)만 보여 줌.
      → 같은 방 사람이 남의 cid로 접속해 자리를 가로챌 수 없음.

실행: pip install -r web/requirements.txt  →  python web/server.py  →  http://localhost:8000
"""
import asyncio
import hashlib
import hmac
import json
import os
import random
import secrets
import sys
import time
from urllib.parse import urlparse

import qrcode
import qrcode.image.svg
from aiohttp import WSMsgType, web

from ranking_store import make_store

HERE = os.path.dirname(os.path.abspath(__file__))
if getattr(sys, "frozen", False):
    # PyInstaller stores web assets and fonts as data files under the bundle root.
    BUNDLE_ROOT = sys._MEIPASS
    STATIC = os.path.join(BUNDLE_ROOT, "web", "static")
    FONTS = os.path.join(BUNDLE_ROOT, "fonts")
else:
    STATIC = os.path.join(HERE, "static")
    FONTS = os.path.join(os.path.dirname(HERE), "fonts")
RANKING_FILE = os.environ.get("KIDK_RANKING_FILE", os.path.join(HERE, "ranking.json"))

GAMES = {"chess": 2, "omok": 2, "yacht": 6, "yut": 4}  # 게임 -> 최대 플레이어 수
SETTING_KEYS = {"time", "turn", "color", "rule", "private", "pieces", "chaos", "team", "tb"}  # 방 설정으로 받는 값
# 칭호: 화면 쪽 목록은 static/js/data/titles.js. 코드는 해시만 둠 (새 코드: sha256(대문자 코드).hexdigest())
TITLE_IDS = {"dev", "real_sua", "kda", "first_win", "chess_s2", "chess_s3", "chess_s5", "chess_s7", "chess_s10", "omok_s2", "omok_s3", "omok_s5", "omok_s7", "omok_s10", "yacht_s2", "yacht_s3", "yacht_s5", "yacht_s7", "yacht_s10", "yut_win", "yut_s2", "yut_s3", "yut_s5", "yut_s7", "yut_s10", "first_game", "spectator", "draw", "teabag", "teabag3", "fast_win", "long_win", "night_win", "comeback", "yut_team", "yut_chaos", "lose_3", "lose_5", "lose_10", "q_about", "q_rules", "q_theme", "q_wrong", "q_nick", "q_sound", "q_flip", "q_logo", "q_tap", "col_half", "col_30", "col_all", "reset_1", "reset_3", "reset_cancel", "muso", "nth_all"}
# 코드 없이 조건을 채워야만 받는 칭호 (전체 해금 코드에는 포함)
EARNED_ONLY_TITLES = {"col_half", "col_30", "col_all", "reset_1", "reset_3", "reset_cancel", "muso", "nth_all"}
# 브라우저가 조건을 세서 신청하는 재미용 칭호 (서버가 확인할 수 없어서 이 목록만 받음. DEV · KDA · 승리 칭호는 신청 불가)
QUIRK_TITLES = {"q_about", "q_rules", "q_theme", "q_nick", "q_sound", "q_flip", "q_logo", "q_tap", "reset_1", "reset_3", "reset_cancel"}
# 전체 칭호 개수와 올컬렉 기준: DEV와 히든 칭호(숨은 재미 · 수집 · 초기화)는 뺌 (titles.js의 COUNTED_TITLES와 같음)
COLLECT_TITLES = TITLE_IDS - {"dev", "real_sua", "q_wrong"} - QUIRK_TITLES - EARNED_ONLY_TITLES
COLLECT_30 = 30
# 전체 해금 코드(DEV 제외)의 해시. 저장소에 두지 않고 서버 환경 변수에만 둠 (없으면 이 기능은 꺼짐)
ALL_TITLES_CODE = os.environ.get("ALL_TITLES_CODE_HASH", "")
TITLE_CODES = {
    "13acab2c360e8a60ffe08123398fd82b0e0acaed781f5169cf9e2df615706e0f": "real_sua",
    "106a2537b95173317a7f5fabfbcc4afc80141db5403df11358eeb62cafe21780": "q_about",
    "b84510a19a4864b1c7c6c5d292c25429a778693ebaf5521ef7828c378c37feb6": "q_rules",
    "f652b2dace6a7afb3029e6c38dbaff9eb27369102807e77de7af127a4f67956e": "q_theme",
    "8e8f9adc59fb83d0ad7e6ef314267ede7b368d91dd94d0c4315ab38428cc1742": "q_wrong",
    "0fc991270470d18b06115d08e6d772986f5f57712e7d17f8060b2f3ef3c0f867": "q_nick",
    "9ebe220cfe767e4472ea8e4f6f58959ab216437954a1f84d8c3b50661ed48d15": "q_sound",
    "c5910818b6417a45dfb03847eaeea5c115120f90cada9c70ff0e881d8c9965fc": "q_flip",
    "54b2be7d438de4abdf83107fc3ce9083bfa3a3a916992e9beb7b30b4781f6581": "q_logo",
    "26a6a24fda990a0b0bcabff77376c08c23ceda6cf45aca6137a7650dd8d5c935": "q_tap",
    "6c072a4839fe4be0aefdf8b989474e6988ae47003c0f12e9367a2e02769cfa61": "first_game",
    "80f48348c33b6f5200b27c236c58997e056705b3e97b8f3d58d372f74cf3aaa3": "spectator",
    "1a6c4739ecb533e82b65686ee0dbdf6c036586be4e343651de239fc4656d0aa2": "draw",
    "9a33b08c825993fef116b7b98688d3bd9e0089d8491cb87994bea463ca93f315": "teabag",
    "d7d9a1d298f0c68edc8e11a5dd43fec0cf1083860bd429143ffd716c34c0b71d": "teabag3",
    "4447741abf7e931e6be475dcb4daeff54cf8d686101dc2e4e42b31460860757a": "fast_win",
    "7346ab370d848da2200520460e9bcea90114cc47c1edcd1d4f90c8a6285ef177": "long_win",
    "9eb5cc509174ea0616db20fe9d6a271f78efa09044ea416aafe05a89da23c77c": "night_win",
    "943a04542324673b03d3e05d905d411373842db8ede4501607655dd69706a043": "comeback",
    "dea3112b555a8c62bceae190a828b4295d030b011b8c9d064f4ac76dab2cf608": "yut_team",
    "e9a3783bd08cf0a198caab2d23e027f1080876c551e11418987fec8c60aa1b2a": "yut_chaos",
    "6383074be774b5bff2f185b497e5ef03d18c8aafb3ef36dcbccdcde2faaba8c9": "lose_3",
    "d0421b2f9aab081ea1f189f86973f83f4a8a4d39569c87c6b8195f983d644a1d": "lose_5",
    "5a866d474b35d2e15ba13f8c898239d98168984f2d65c2b7084823f6f984eb71": "lose_10",
    "d39f3e0d928a104df91620be33d9e94b7f926e063ed2083412bf6bbf8c5fd719": "dev",
    "9cb10eb12c048236a65e59514d4d283d41663dcc62f319bc473f3cb4d1584976": "kda",
    "6a9d1190b7440e5e6cc98b3947543b5726e6e9c749724c790b1f5602d9816831": "first_win",
    "dc4b60441e78429e4586b50fe21f154397babc21f56ab5012fd2513b14c0d4bb": "chess_s2",
    "b5b45931dcc4ca7291c131742d7ba349a53f19dc5332e8d73e70fa2727d9c88a": "chess_s3",
    "01b8d9d8782ae2ce8b322a3cc08a8942c7e158ed806d50605fa8f25e089193bf": "chess_s5",
    "ea2c7bb142ebf13be7620fa384b541dfe026e523e3b0c35bc3c27bf33fea85c3": "chess_s7",
    "b34a0eabe406ee5ef1b62b594af365475bb97b1acf79b1f24ea4a9a208df8bf8": "chess_s10",
    "45b5547cad7c9469c8b1fa047c42def08d039e2024e44a4ee5abed336bdc572d": "omok_s2",
    "0c115ada6c6dd99044c981a46494bac84eef6091ef94a32319b3cbad16d05b72": "omok_s3",
    "dbf0960d814817654786b2b0267e8740099a7cf8f0d36049f662a84d6fb81d2c": "omok_s5",
    "8614caa3a5515728408469df7fe0091fd10592b8cad790153aef2cf2fe67bc04": "omok_s7",
    "748ae46ceb71a90b57846a2dc2f46b8c15d941d50e7cacc723650841af0443ee": "omok_s10",
    "91e7d4c529736d0dce26966a8de6dbcdbc3b7e113869cbf7f61705f0578eae6c": "yacht_s2",
    "8dcdafeda9a0c24a35a49c00de3d94d80f3c7601135380fac21c1673feb04b99": "yacht_s3",
    "35d7995f60a588dd75a8176d3e267e3f3db82e1f5882df13805521c37413665b": "yacht_s5",
    "eab0cf9b4f98822a30548257ce63fcaed81855ac67c5f984f2bbee8a42e169f1": "yacht_s7",
    "08d3523b8e39b23ac9896bf72905b34759236c6492acaaf677233fb60946d239": "yacht_s10",
    "ba27816cb4b70cdb2d507c2300d15d30d750d51b1996083f53339fa5491a8979": "yut_win",
    "8f9ac6675ccd29b58b2f025390862692eb7bcdc51630c34069dc1c557cba79d2": "yut_s2",
    "e21356a1b1b4e382499a3fee9944a17efc41ad00e77e9e498ea59ebae8f452ac": "yut_s3",
    "b37c318daa4f2b50d0efa27e1392e83e8d0cc99281437f52220a84d81941f898": "yut_s5",
    "92f92d4b465ec5d509503127ece0c66e1a369db2f704b82927d35bd7af86cc38": "yut_s7",
    "0763a384615eae67484228b1e141edac75e9b3f37df07e9f2852d130a6323774": "yut_s10",
}
TEABAG_STYLES = {"teabag", "stomp", "kick"}
RESERVED_NAMES = {"개발자", "관리자", "운영자", "운영진", "dev", "admin", "administrator", "gm", "시스템", "system", "공지"}  # 운영자인 척 못 하게
FX_KINDS = {"teabag", "taunt", "shake"}
YUT_SKINS = {"penguin", "tiger", "rabbit", "frog", "bear", "cat", "chick", "fox"}  # 기록 없이 전달하는 효과
MAX_MSG = 40_000  # 메시지 하나 최대 크기 (프로필 사진 포함해도 충분)
MAX_PHOTO = 20_000  # 96px 프로필 사진은 보통 몇 KB
MAX_ACT = 600  # 게임 수 하나의 최대 크기 (보통 100바이트 안팎)
MAX_MEMBERS = 30  # 한 방의 사람 수 상한 (플레이어 + 관전 + 대기 줄)
MAX_LOG_BYTES = 512 * 1024  # 한 판의 기록이 차지하는 메모리 상한
AUTO_NEXT_SECONDS = 15  # 줄 선 사람이 있으면 결과 뒤 이만큼 있다가 다음 판을 자동으로 시작 (체스 · 오목)
MIN_GAME_SECONDS = 3  # 이보다 짧은 판은 기록 · 칭호에 넣지 않음
ROOM_SEND_INTERVAL = 0.25  # 방 정보는 이 간격으로 묶어서 보냄 (트래픽 절약)
ROOMS_SEND_INTERVAL = 1.0  # 방 목록도 마찬가지
HELLO_TIMEOUT = 10  # 접속 후 비밀 열쇠를 보내기까지 기다리는 시간(초)
# 한 주소(IP) 전체에 거는 제한: (횟수, 초). 학교 와이파이는 반 전체가 같은 주소라 넉넉하게
IP_LIMITS = {"msg": (200, 5), "connect": (120, 60), "join": (60, 60), "photo": (6, 60), "rooms": (60, 60),
             "ranking": (20, 60), "record": (30, 60), "qr": (60, 60)}
MAX_TEXT = 100
MAX_LOG = 3000
GRACE = 30  # 연결이 끊긴 사람의 자리를 지켜 주는 시간(초)
RATE_WINDOW = 5  # 도배 막기: 이 시간(초) 동안
RATE_ALL, RATE_CHAT = 60, 8  # 메시지 전체 / 채팅 효과 최대 개수
RATE_CHAT_MESSAGES = 8  # 실제 채팅 메시지 최대 개수 (RATE_WINDOW 기준)
RATE_REPEAT_MESSAGES = 5  # 같은 내용은 짧은 시간에 최대 5회
MAX_PER_IP = int(os.environ.get("KIDK_MAX_PER_IP", 60))  # 한 주소(IP)당 동시 연결 (학교 와이파이는 반 전체가 같은 주소)
MAX_CLIENTS, MAX_ROOMS = 1000, 150  # 서버 전체 상한 (무료 서버가 버틸 만큼)
IDLE_LOBBY, IDLE_ROOM = 20 * 60, 45 * 60  # 이만큼(초) 아무것도 안 하면 연결을 끊어 서버가 잠들 수 있게 함
ROOM_ADJ = ["용감한", "졸린", "신나는", "수줍은", "배고픈", "반짝이는", "느긋한", "씩씩한", "엉뚱한", "다정한"]
ROOM_ANIMAL = ["판다", "여우", "토끼", "곰돌이", "병아리", "개구리", "고양이", "돼지", "펭귄", "다람쥐"]
ANIMALS = {"cat", "bear", "rabbit", "frog", "chick", "pig", "panda", "fox", "penguin", "tiger"}
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 헷갈리는 0/O, 1/I 뺌


def now_ms():
    return int(time.time() * 1000)


def clean_text(s, limit):
    return " ".join(str(s or "").split())[:limit]


def _title_secret():
    """칭호 표를 서명하는 비밀값. Render는 TITLE_SECRET(자동 생성), 내 PC는 파일에 한 번 만들어 둠."""
    env = os.environ.get("TITLE_SECRET") or os.environ.get("SUPABASE_SERVICE_KEY")
    if env:
        return hashlib.sha256(env.encode()).digest()
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".title_secret")
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        value = secrets.token_bytes(32)
        try:
            with open(path, "wb") as f:
                f.write(value)
        except OSError:
            pass
        return value


TITLE_SECRET = _title_secret()


def title_token(cid, title):
    """이 사람(비밀 열쇠)이 이 칭호를 가졌다는 표. 다른 사람이 복사해 써도 통하지 않음."""
    return hmac.new(TITLE_SECRET, f"{cid}:{title}".encode(), hashlib.sha256).hexdigest()[:32]


def player_id_for(cid):
    """랭킹에 쓰는 플레이어 번호 (비밀 열쇠로 계산하지만, 번호로 열쇠를 알아낼 수는 없음)."""
    return hmac.new(TITLE_SECRET, f"player:{cid}".encode(), hashlib.sha256).hexdigest()[:16].upper()


def _record_sig(player_id):
    return hmac.new(TITLE_SECRET, f"record:{player_id}".encode(), hashlib.sha256).hexdigest()[:12].upper()


def record_code(player_id):
    """기록 복구 코드: 브라우저 기록을 지웠거나 다른 기기에서 내 랭킹 기록을 이어 갈 때 입력"""
    return f"R1-{player_id}-{_record_sig(player_id)}"


def player_from_code(code):
    """기록 복구 코드가 가리키는 플레이어 번호, 아니면 None"""
    parts = code.upper().split("-") if isinstance(code, str) else []
    if len(parts) == 3 and parts[0] == "R1" and len(parts[1]) == 16 and hmac.compare_digest(parts[2], _record_sig(parts[1])):
        return parts[1]
    return None


def restore_code(title):
    """칭호 복구 코드: 브라우저 기록을 지웠거나 다른 기기에서 다시 받을 때 입력"""
    nonce = secrets.token_hex(3).upper()
    return f"T1-{title.upper()}-{nonce}-{_restore_sig(title, nonce)}"


def _restore_sig(title, nonce):
    return hmac.new(TITLE_SECRET, f"restore:{title}:{nonce}".encode(), hashlib.sha256).hexdigest()[:12].upper()


def title_from_code(code):
    """입력한 코드가 가리키는 칭호 (복구 코드 또는 등록된 코드), 아니면 None"""
    parts = code.split("-")
    if len(parts) == 4 and parts[0] == "T1":
        title = parts[1].lower()
        if title in TITLE_IDS and hmac.compare_digest(parts[3], _restore_sig(title, parts[2])):
            return title
        return None
    return TITLE_CODES.get(hashlib.sha256(code.encode()).hexdigest())


def name_key(name):
    return "".join(str(name).split()).casefold()


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
    if fx.get("style") in TEABAG_STYLES:
        out["style"] = fx["style"]
    return out


class Client:
    def __init__(self, cid, ip):
        self.cid = cid  # 비밀 (본인 브라우저만 앎)
        self.pid = secrets.token_hex(6)  # 공개 번호 (다른 사람에게 보이는 이름표)
        self.ip = ip
        self.ws = None
        self.player_id = player_id_for(cid)  # 랭킹 번호 (기록 복구 코드를 넣으면 그 번호로 바뀜)
        self.profile = None  # {name, avatar, intro} avatar는 동물 이름 또는 "photo:<pid>:<해시>"
        self.photo = None  # 사진 data URL (따로 한 번만 보냄)
        self.room = None
        self.gone_at = None  # 연결이 끊긴 시각 (다시 들어오면 None)
        self.last_active = time.time()
        self.sent = {"all": [], "chat": [], "redeem": []}  # 최근 보낸 메시지 시각 (도배 막기)
        self.sent_chat = []
        self.teabag_wins = 0  # 이기고 티배깅한 판 수 (칭호용)
        self.wrong_codes = 0  # 틀리게 넣은 칭호 코드 수 (칭호용)

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
        self.player_id = player_from_code(p.get("recordCode")) or self.player_id  # 다른 사람에게 보내는 프로필에는 넣지 않음
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
        title, token = p.get("title"), p.get("titleToken")
        if title in TITLE_IDS and isinstance(token, str) and hmac.compare_digest(token, title_token(self.cid, title)):
            self.profile["title"] = title  # 서버가 준 표가 있어야만 칭호가 보임
        if name_key(name) in RESERVED_NAMES and self.profile.get("title") != "dev":
            self.profile["name"] = "플레이어"
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


def collect_titles(cid, tokens, resetting=False):
    """가진 칭호 표를 확인해서, 모은 수에 맞는 수집 칭호를 돌려줌."""
    def owns(title):
        token = tokens.get(title)
        return isinstance(token, str) and hmac.compare_digest(token, title_token(cid, title))
    count = sum(1 for title in COLLECT_TITLES if owns(title))
    complete = count == len(COLLECT_TITLES)
    if resetting:  # 다 모은 채로 초기화
        return ["muso"] if complete else []
    earned = []
    if count * 2 >= len(COLLECT_TITLES):
        earned.append("col_half")
    if count >= COLLECT_30:
        earned.append("col_30")
    if complete:
        earned.append("col_all")
        if owns("reset_1"):  # 초기화한 뒤 다시 다 모음
            earned.append("nth_all")
    return earned


def win_titles(room, streak, lost_before, now=None):
    """이긴 사람이 받는 칭호: 연승 단계와 이번 판의 조건"""
    now = time.time() if now is None else now
    earned = ["first_win"] + [f"{room.game}_s{n}" for n in (2, 3, 5, 7, 10) if streak >= n]
    if room.game == "yut":
        earned.append("yut_win")
        if room.settings.get("team") == "1":
            earned.append("yut_team")
        if room.settings.get("chaos") != "basic":  # 초능력 모드 (값이 없으면 기본값이 초능력)
            earned.append("yut_chaos")
    played = now - room.started_at
    if played < 60:
        earned.append("fast_win")
    elif played >= 1200:
        earned.append("long_win")
    hour = time.gmtime(now + 9 * 3600).tm_hour  # 한국 시각
    if hour >= 23 or hour < 6:
        earned.append("night_win")
    if lost_before >= 3:
        earned.append("comeback")
    return earned


class Room:
    def __init__(self, rid, game, settings, host):
        self.id = rid
        self.game = game
        self.settings = settings
        self.name = f"{random.choice(ROOM_ADJ)} {random.choice(ROOM_ANIMAL)} 방"
        self.host = host  # cid
        self.members = []  # [cid, role] 들어온 순서대로. role: player / spectator
        self.yut_skins = {}  # cid -> character id; empty means unselected
        self.team_skins = {"A": "", "B": ""}  # 윷놀이 팀전: 팀마다 같이 쓰는 말
        self.status = "waiting"  # waiting / playing / done
        self.log = []  # 이번 판의 수 (늦게 들어온 사람과 재접속한 사람이 다시 계산하는 재료)
        self.seq = 0
        self.seat_names = []  # 판을 시작할 때 앉아 있던 사람들 (랭킹은 이 이름만 받음)
        self.seat_cids = []
        self.seat_ids = []  # 앉은 사람들의 플레이어 번호 (기록은 이 번호로)
        self.queue = []  # 다음 판을 기다리는 줄 (cid, 먼저 선 순서)
        self.streak = {}  # cid -> 이 방에서 이어 온 연승 수
        self.lose_streak = {}  # cid -> 이 방에서 이어 온 연패 수
        self.started_at = 0  # 이번 판을 시작한 시각
        self.log_bytes = 0  # 이번 판 기록의 크기
        self.result_votes = {}  # cid -> (이긴 사람들, 진 사람들): 앉은 사람들이 각자 계산해 보낸 결과
        self.sent_at = 0.0  # 방 정보를 마지막으로 보낸 시각
        self.send_later = None  # 묶어서 보내려고 기다리는 작업
        self.teabag_ready = set()  # 지난 판을 이겨서 아직 티배깅하지 않은 cid (한 판에 한 번만 셈)
        self.losers = []
        self.last_seats = []  # 지난 판 자리 순서 (cid)
        self.last_winners = []  # 지난 판 이긴 사람 (cid)
        self.draws = 0  # 이어진 무승부 수
        self.next_at = 0  # 다음 판 자동 시작 시각 (ms, 없으면 0)
        self.next_task = None
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

    def yut_team_of(self, cid, pid):
        """윷놀이 팀전에서 이 사람의 팀. 방장이 안 나눴으면 들어온 순서로 2 · 4번째가 B팀 (app.js roomTeamB와 같음)."""
        tb = self.settings.get("tb")
        if tb is not None:
            return "B" if pid in tb.split(",") else "A"
        players = self.players()
        return "B" if cid in players and players.index(cid) % 2 == 1 else "A"


class Hub:
    def __init__(self):
        self.clients = {}  # cid -> Client
        self.by_pid = {}  # pid -> Client
        self.rooms = {}
        self.store = make_store(RANKING_FILE)
        self.ip_hits = {}  # (주소, 종류) -> 최근 시각들
        self.pending = {}  # 주소 -> 비밀 열쇠를 아직 안 보낸 연결 수
        self.rooms_sent_at = 0.0
        self.rooms_later = None

    def pid(self, cid):
        c = self.clients.get(cid)
        return c.pid if c else None

    def connections_from(self, ip):
        """이 주소가 차지한 자리 수. 끊긴 뒤 자리를 지켜 주는 사람도 셈 (열고 닫기만 반복해 자리를 채우지 못하게)."""
        return sum(1 for c in self.clients.values() if c.ip == ip)

    def ip_allow(self, ip, kind):
        """주소 전체에 거는 횟수 제한."""
        limit, window = IP_LIMITS[kind]
        now = time.time()
        times = [x for x in self.ip_hits.get((ip, kind), []) if now - x < window]
        allowed = len(times) < limit
        if allowed:
            times.append(now)
        self.ip_hits[(ip, kind)] = times
        return allowed

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
                "team_skins": room.team_skins, "host": self.pid(room.host), "status": room.status, "members": members, "max": GAMES[room.game],
                "queue": [self.pid(c) for c in room.queue], "grace": GRACE, "next_at": room.next_at}

    def room_summary(self, room):
        host = self.clients.get(room.host)
        king = max(room.streak.items(), key=lambda kv: kv[1], default=(None, 0))
        king_client = self.clients.get(king[0])
        return {"id": room.id, "name": room.name, "game": room.game, "status": room.status,
                "host": host.profile["name"] if host and host.profile else "?",
                "players": len(room.players()), "max": GAMES[room.game],
                "spectators": sum(1 for _, r in room.members if r == "spectator"), "queue": len(room.queue),
                "king": {"name": king_client.profile["name"], "streak": king[1]}
                if king[1] >= 1 and king_client and king_client.profile else None}

    async def send_room(self, room, now=False):
        """방 정보를 방 전체에 보냄. 짧은 시간에 여러 번 바뀌면 마지막 상태만 묶어서 보냄 (now: 바로 보내야 할 때)."""
        wait = room.sent_at + ROOM_SEND_INTERVAL - time.time()
        if wait > 0 and not now:
            if room.send_later is None:
                room.send_later = asyncio.ensure_future(self._send_room_later(room, wait))
            return
        room.sent_at = time.time()
        view = self.room_view(room)
        await asyncio.gather(*(self.clients[cid].send({"t": "room", "room": view})
                               for cid, _ in room.members if cid in self.clients))
        await self.send_rooms()

    async def _send_room_later(self, room, wait):
        await asyncio.sleep(wait)
        room.send_later = None
        if self.rooms.get(room.id) is room:
            await self.send_room(room)

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
        wait = self.rooms_sent_at + ROOMS_SEND_INTERVAL - time.time()
        if wait > 0:
            if self.rooms_later is None:
                self.rooms_later = asyncio.ensure_future(self._send_rooms_later(wait))
            return
        self.rooms_sent_at = time.time()
        rooms = self.public_rooms()
        await asyncio.gather(*(c.send({"t": "rooms", "rooms": rooms})
                               for c in self.clients.values() if c.room is None and c.profile))

    async def _send_rooms_later(self, wait):
        await asyncio.sleep(wait)
        self.rooms_later = None
        await self.send_rooms()

    async def to_room(self, room, obj):
        await asyncio.gather(*(self.clients[cid].send(obj) for cid, _ in room.members if cid in self.clients))

    # ------------------------------------------------------------ 방
    def new_code(self):
        while True:
            code = "".join(secrets.choice(CODE_CHARS) for _ in range(4))
            if code not in self.rooms:
                return code

    def rotate_seats(self, room, out):
        """줄 선 사람이 있으면 out(진 사람)을 줄 맨 뒤로 보내고 줄 앞사람을 앉힘. 자리에서 벗어나면 연승은 끝."""
        if not room.queue:
            return
        for cid in out:
            if room.role_of(cid) == "player":
                room.set_role(cid, "spectator")
                room.queue.append(cid)
                room.streak.pop(cid, None)
        self.fill_seats(room)

    def next_order(self, room):
        """연승전 자리 순서: 첫 자리가 선공. 진 사람 · 도전자가 선공이고, 같은 두 사람이 비겼으면 바꿔 앉음. 첫 판은 None (방 설정대로)"""
        players = room.players()
        if GAMES[room.game] != 2 or len(players) != 2 or not room.last_seats:
            return None
        champions = [c for c in players if c in room.last_winners]
        if len(champions) == 1:
            order = [c for c in players if c != champions[0]] + champions
        elif set(players) == set(room.last_seats):
            order = list(reversed(room.last_seats))
        else:
            return None
        return [self.clients[c].pid for c in order if c in self.clients]

    def cancel_auto_next(self, room):
        room.next_at = 0
        if room.next_task:
            room.next_task.cancel()
            room.next_task = None

    async def start_next(self, room):
        """체스 · 오목 다음 판을 서버가 바로 시작 (방장 기기 상태와 상관없음). 자리가 비었거나 끊긴 사람이 있으면 False"""
        players = room.players()
        ready = [c for c in players if c in self.clients and self.clients[c].gone_at is None and self.clients[c].profile]
        if room.status != "done" or room.game not in ("chess", "omok") or len(ready) < GAMES[room.game] or len(players) != len(ready):
            return False
        self.cancel_auto_next(room)
        kept = {"chess": ("time",), "omok": ("rule", "turn")}[room.game]
        settings = {k: room.settings[k] for k in kept if k in room.settings}
        await self.act(room, room.host, {"type": "start", "game": room.game, "settings": settings})
        await self.send_room(room, now=True)
        return True

    async def to_waiting(self, room):
        """대기실로 돌아감"""
        self.cancel_auto_next(room)
        room.status = "waiting"
        room.log = []
        self.fill_seats(room)
        await self.to_room(room, {"t": "reset"})
        await self.send_room(room, now=True)

    async def auto_next_later(self, room):
        await asyncio.sleep(AUTO_NEXT_SECONDS)
        room.next_task = None
        room.next_at = 0
        if self.rooms.get(room.id) is room and room.status == "done" and not await self.start_next(room):
            await self.send_room(room, now=True)

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

    def name_taken(self, room, client):
        """이 방에 같은 닉네임을 쓰는 다른 사람이 있는지 (결과 · 연승이 이름으로 묶여서 겹치면 안 됨)"""
        key = name_key(client.profile["name"])
        for cid, _ in room.members:
            other = self.clients.get(cid)
            if other is not None and other is not client and other.profile and name_key(other.profile["name"]) == key:
                return True
        return False

    async def join(self, client, room, want="player"):
        if client.cid in room.banned:
            await client.send({"t": "error", "msg": "방장이 내보낸 방이라 다시 들어갈 수 없어요."})
            return
        if self.name_taken(room, client):
            await client.send({"t": "error", "msg": "이 방에 같은 닉네임이 있어요. 닉네임을 바꾼 뒤 다시 들어와 주세요."})
            return
        if len(room.members) >= MAX_MEMBERS:
            await client.send({"t": "error", "msg": "이 방은 사람이 너무 많아요. 다른 방을 이용해 주세요."})
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
        await self.send_room(room, now=True)
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
            room.log_bytes = 0
            room.result_votes = {}
            room.status = "playing"
            room.started_at = time.time()
            a["game"] = room.game  # 방과 다른 게임으로 시작하거나 엉뚱한 설정을 보내지 못하게
            a["settings"] = clean_settings(a.get("settings"))
            self.cancel_auto_next(room)
            order = self.next_order(room) or a.pop("order", None)  # 둘째 판부터는 도전자가 선공
            a.pop("order", None)
            room.seat_cids, a["seats"] = self.seats_for_start(room, order)
            room.seat_names = [self.clients[c].profile["name"] for c in room.seat_cids]
            room.seat_ids = [self.clients[c].player_id for c in room.seat_cids]
            settings = a.get("settings")
            if room.game == "yut" and isinstance(settings, dict) and settings.get("team") == "1":
                for i, seat in enumerate(a["seats"]):  # 자리 순서가 A, B, A, B
                    seat["yut_skin"] = room.team_skins["B" if i % 2 else "A"]
            room.losers = []
            if room.game == "yut":
                a["seed"] = secrets.randbits(31)  # 시작 카드 나눠 주기도 서버가 정한 씨앗으로
        elif a.get("type") == "roll" and room.game == "yacht":
            a["dice"] = [secrets.randbelow(6) + 1 for _ in range(5)]  # 주사위는 서버가 굴림 (조작 방지)
        elif room.game == "yut":
            a["seed"] = secrets.randbits(31)  # 윷 결과 · 능력 뽑기 등 모든 무작위는 서버가 정한 씨앗으로
        size = len(json.dumps(entry))
        if len(room.log) < MAX_LOG and room.log_bytes + size <= MAX_LOG_BYTES:
            room.log.append(entry)
            room.log_bytes += size
        await self.to_room(room, {"t": "act", **entry})

    # ------------------------------------------------------------ 메시지 처리
    async def handle(self, client, msg):
        t = msg.get("t")
        if not client.allow("all", RATE_ALL) or (t == "fx" and not client.allow("chat", RATE_CHAT)):
            return  # 너무 빨리 보내면 버림
        if not self.ip_allow(client.ip, "msg"):
            return
        if t == "ping":
            await client.send({"t": "pong", "c": msg.get("c"), "s": now_ms()})
            return
        client.last_active = time.time()
        if t == "profile":
            old_name = client.profile["name"] if client.profile else None
            room = self.rooms.get(client.room)
            # 방 안에서 사진을 바꾸면 방 전체로 다시 보내지므로 주소마다 횟수를 제한 (넘으면 이전 사진 유지)
            profile = msg.get("profile")
            if (room and isinstance(profile, dict) and isinstance(profile.get("avatar"), str)
                    and profile["avatar"].startswith("data:image/") and profile["avatar"] != client.photo
                    and not self.ip_allow(client.ip, "photo")):
                profile = {**profile, "avatar": client.photo or "cat"}
            photo_changed = client.set_profile(profile)
            if room and client.profile:
                if old_name and self.name_taken(room, client):  # 방 안에서 남과 같은 이름으로는 못 바꿈
                    client.profile["name"] = old_name
                    await client.send({"t": "error", "msg": "이 방에 같은 닉네임이 있어서 이름을 바꾸지 못했어요."})
                if photo_changed:
                    await self.send_photos(room, only=client)
                await self.send_room(room)
            return
        if t == "redeem":  # 칭호 코드 입력
            if not client.allow("redeem", RATE_CHAT):
                return
            code = "".join(str(msg.get("code") or "").upper().split())[:40]
            player_id = player_from_code(code)
            if player_id:  # 기록 복구 코드
                client.player_id = player_id
                await client.send({"t": "record_bind", "code": code})
                return
            if ALL_TITLES_CODE and hmac.compare_digest(hashlib.sha256(code.encode()).hexdigest(), ALL_TITLES_CODE):
                await client.send({"t": "title_grant_all", "titles": {t: title_token(client.cid, t) for t in TITLE_IDS - {"dev", "real_sua"}}})
                return
            title = title_from_code(code)
            await client.send({"t": "title_grant", "title": title, "token": title_token(client.cid, title), "via": "code"} if title else {"t": "title_bad"})
            if not title:
                client.wrong_codes += 1
                if client.wrong_codes >= 5:
                    await self.grant_titles(client.cid, ["q_wrong"])
            return
        if t == "quirk":  # 브라우저가 세어 본 재미용 칭호 신청
            if client.allow("redeem", RATE_CHAT) and msg.get("title") in QUIRK_TITLES:
                await self.grant_titles(client.cid, [msg["title"]])
            return
        if t == "collect":  # 모은 칭호 수 확인: 브라우저 말이 아니라 표를 서버가 직접 확인함
            tokens = msg.get("tokens")
            if client.allow("redeem", RATE_CHAT) and isinstance(tokens, dict):
                await self.grant_titles(client.cid, collect_titles(client.cid, tokens, msg.get("resetting") is True))
            return
        if t == "record_code":  # 내 랭킹 기록의 복구 코드 받기
            if client.allow("redeem", RATE_CHAT):
                await client.send({"t": "record_code", "code": record_code(client.player_id)})
            return
        if t == "title_backup":  # 가진 칭호의 복구 코드 받기
            title, token = msg.get("title"), msg.get("token")
            if (client.allow("redeem", RATE_CHAT) and title in TITLE_IDS and isinstance(token, str)
                    and hmac.compare_digest(token, title_token(client.cid, title))):
                await client.send({"t": "title_code", "title": title, "code": restore_code(title)})
            return
        if client.profile is None:
            return
        room = self.rooms.get(client.room)
        if t == "rooms":
            if self.ip_allow(client.ip, "rooms"):
                await client.send({"t": "rooms", "rooms": self.public_rooms()})
        elif t == "ranking":
            if self.ip_allow(client.ip, "ranking"):
                await client.send({"t": "ranking", "rows": await self.store.all(), "ok": self.store.ok, "store": self.store.kind, "me": client.player_id})
        elif t == "create":
            game = msg.get("game")
            if game not in GAMES or not self.ip_allow(client.ip, "join"):
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
            if target is not room and self.ip_allow(client.ip, "join"):
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
                                          "title": client.profile.get("title", ""),  # 표가 확인된 칭호만 들어 있음
                                          "text": text, "sticker": sticker, "at": now_ms()})
        elif t == "fx":  # 도발 멘트 · 티배깅 · 컵 흔들기처럼 기록할 필요 없는 효과
            fx = clean_fx(msg.get("fx"))
            if fx:
                await self.to_room(room, {"t": "fx", "from": client.pid, "fx": fx})
                if fx["kind"] == "teabag" and client.cid in room.teabag_ready:
                    room.teabag_ready.discard(client.cid)
                    client.teabag_wins += 1
                    await self.grant_titles(client.cid, ["teabag"] + (["teabag3"] if client.teabag_wins >= 3 else []))
        elif t == "yut_skin" and room.game == "yut" and room.status != "playing":
            target = client  # 말은 본인 것만 고름 (방장도 남의 말은 못 고름)
            if room.role_of(target.cid) != "player":
                return
            skin = msg.get("skin")
            if not isinstance(skin, str) or (skin and skin not in YUT_SKINS):
                return
            if skin and any(cid != target.cid and room.role_of(cid) == "player" and room.yut_skins.get(cid) == skin for cid, _ in room.members):
                return
            room.yut_skins[target.cid] = skin
            await self.send_room(room)
        elif t == "yut_team_skin" and room.game == "yut" and room.status != "playing":
            team, skin = msg.get("team"), msg.get("skin")
            if team not in room.team_skins or not isinstance(skin, str) or (skin and skin not in YUT_SKINS):
                return
            if room.role_of(client.cid) != "player" or room.yut_team_of(client.cid, client.pid) != team:
                return  # 자기 팀 말만 고름 (방장도 상대 팀 말은 못 고름)
            if skin and room.team_skins["B" if team == "A" else "A"] == skin:
                return
            room.team_skins[team] = skin
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
        elif t == "host" and client.cid == room.host:  # 방장 넘기기 (연결된 사람에게만)
            target = self.by_pid.get(str(msg.get("pid")))
            if target is None or target is client or target.room != room.id or target.gone_at is not None:
                return
            room.host = target.cid
            await self.to_room(room, {"t": "notice", "kind": "host", "name": target.profile["name"]})
            await self.send_room(room)
        elif t == "seat":  # 플레이어 <-> 관전자, 꽉 찼으면 줄 서기
            role = room.role_of(client.cid)
            if msg.get("role") == "spectator":
                if client.cid in room.queue:
                    room.queue.remove(client.cid)  # 줄에서 빠지기
                elif role == "player" and room.status != "playing":
                    room.set_role(client.cid, "spectator")
                    room.streak.pop(client.cid, None)  # 자리를 비우면 연승은 끝
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
                if client.cid != room.host or room.status == "playing" or len(room.players()) < 2:
                    return  # 혼자서는 판을 시작할 수 없음 (혼자 이겼다고 기록을 쌓지 못하게)
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
        elif t == "result" and client.cid in room.seat_cids and room.status == "playing":
            players = list(dict.fromkeys(room.seat_names))  # 클라이언트가 보낸 이름 목록은 믿지 않음
            winners = [n for n in dict.fromkeys(clean_text(n, 12) for n in msg.get("winners", [])[:6]) if n in players]
            losers = [n for n in dict.fromkeys(clean_text(n, 12) for n in msg.get("losers", [])[:6])
                      if n in players and n not in winners]
            room.result_votes[client.cid] = (tuple(sorted(winners)), losers)
            # 앉은 사람 중 연결된 사람 둘이 같은 결과를 보내야 끝남 (남은 사람이 한 명이면 한 명으로 충분)
            seated = [c for c in room.seat_cids if room.role_of(c) and self.clients[c].gone_at is None]
            agree = sum(1 for key, _ in room.result_votes.values() if key == tuple(sorted(winners)))
            if agree >= max(1, min(2, len(seated))):
                await self.finish_game(room, client, players, winners, losers)
        elif t == "reset" and room.status == "done" and (client.cid == room.host or room.role_of(client.cid) == "player"):
            # 한 판 더: 방장이나 지금 자리에 앉은 사람 누구나 (줄 앞사람은 판이 끝날 때 이미 앉아 있음)
            if not (msg.get("rematch") and await self.start_next(room)):
                await self.to_waiting(room)

    async def finish_game(self, room, client, players, winners, losers):
        """결과가 맞춰진 판을 끝냄. 너무 짧거나 한 주소에서 너무 많이 끝낸 판은 기록 · 칭호에 넣지 않음."""
        room.status = "done"
        counted = (time.time() - room.started_at >= MIN_GAME_SECONDS and len(set(room.seat_ids)) >= 2  # 같은 번호끼리 한 판은 세지 않음
                   and self.ip_allow(client.ip, "record"))
        loser_cids = [cid for cid, name in zip(room.seat_cids, room.seat_names) if name in losers]
        room.last_seats = list(room.seat_cids)
        room.last_winners = [cid for cid, name in zip(room.seat_cids, room.seat_names) if name in winners]
        if counted:
            for cid, name in zip(room.seat_cids, room.seat_names):
                earned = ["first_game"]
                if not winners:  # 무승부는 연승 · 연패를 그대로 둠
                    earned.append("draw")
                elif name in winners:
                    room.streak[cid] = room.streak.get(cid, 0) + 1
                    earned += win_titles(room, room.streak[cid], room.lose_streak.get(cid, 0))
                    room.lose_streak[cid] = 0
                else:
                    room.streak[cid] = 0
                    room.lose_streak[cid] = room.lose_streak.get(cid, 0) + 1
                    earned += [f"lose_{n}" for n in (3, 5, 10) if room.lose_streak[cid] >= n]
                await self.grant_titles(cid, earned)
            for cid, role in room.members:
                if role == "spectator":
                    await self.grant_titles(cid, ["spectator"])
            room.teabag_ready = {cid for cid, name in zip(room.seat_cids, room.seat_names) if name in winners}
            await self.store.add(room.game, [{"id": pid, "name": name} for pid, name in zip(room.seat_ids, room.seat_names)],
                                 [pid for pid, name in zip(room.seat_ids, room.seat_names) if name in winners])
            # 판이 끝나는 즉시 자리를 바꿈. 너무 짧은 판은 기록에도 줄에도 넣지 않음
            room.draws = 0 if winners else room.draws + 1
            had_queue = bool(room.queue)
            if winners:
                self.rotate_seats(room, loser_cids)
            elif room.draws >= 2:  # 두 판 연속 비기면 둘 다 줄 뒤로
                self.rotate_seats(room, list(room.seat_cids))
                room.draws = 0
            if had_queue and room.game in ("chess", "omok"):
                room.next_at = now_ms() + AUTO_NEXT_SECONDS * 1000
                room.next_task = asyncio.ensure_future(self.auto_next_later(room))
        await self.send_room(room, now=True)

    async def grant_titles(self, cid, titles):
        """칭호 표를 보내 줌 (이미 가졌으면 브라우저가 알아서 무시)"""
        client = self.clients.get(cid)
        if client is None:
            return
        for title in titles:
            if title in TITLE_IDS:
                await client.send({"t": "title_grant", "title": title, "token": title_token(cid, title), "via": "earned"})

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
            self.ip_hits = {k: v for k, v in self.ip_hits.items() if v and now - v[-1] < 120}
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


async def read_hello(ws):
    """접속 뒤 첫 메시지로 받은 비밀 열쇠 (주소에 넣으면 접속 기록에 남아서 이렇게 받음)."""
    try:
        m = await ws.receive(timeout=HELLO_TIMEOUT)
        msg = json.loads(m.data) if m.type == WSMsgType.TEXT else None
    except (asyncio.TimeoutError, ValueError):
        return None
    return clean_text(msg.get("cid"), 40) if isinstance(msg, dict) and msg.get("t") == "hello" else None


def slots_full(ip):
    return hub.connections_from(ip) >= MAX_PER_IP or len(hub.clients) >= MAX_CLIENTS


async def ws_handler(request):
    if not same_origin(request):
        return web.Response(status=403, text="origin")
    ip = client_ip(request)
    if not hub.ip_allow(ip, "connect"):
        return web.Response(status=429, text="too many connections")
    cid = clean_text(request.query.get("cid"), 40)  # 예전 화면(새로고침 전 탭)과의 호환용
    if cid and hub.clients.get(cid) is None and slots_full(ip):
        return web.Response(status=429, text="too many connections")
    if not cid and hub.pending.get(ip, 0) >= MAX_PER_IP:
        return web.Response(status=429, text="too many connections")
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=MAX_MSG)
    await ws.prepare(request)
    if not cid:
        hub.pending[ip] = hub.pending.get(ip, 0) + 1
        try:
            cid = await read_hello(ws)
        finally:
            hub.pending[ip] -= 1
            if not hub.pending[ip]:
                del hub.pending[ip]
        if cid is None:
            await ws.close(code=4002, message=b"hello")
            return ws
        if hub.clients.get(cid) is None and slots_full(ip):
            await ws.close(code=4029, message=b"too many connections")
            return ws
    if len(cid) < 16:
        cid = secrets.token_hex(16)
    client = hub.clients.get(cid)
    if client is None:
        client = hub.clients[cid] = Client(cid, ip)
        hub.by_pid[client.pid] = client
    elif client.ws is not None and not client.ws.closed:
        await client.ws.close(code=4001, message=b"replaced")  # 같은 사람이 새 탭에서 들어오면 옛 연결은 정리
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
        await hub.send_room(room, now=True)
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
    if not hub.ip_allow(client_ip(request), "qr"):
        return web.Response(status=429)
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
    elif request.path.endswith((".png", ".svg", ".wav", ".ttf")) and "Cache-Control" not in resp.headers:
        resp.headers["Cache-Control"] = "public, max-age=604800"  # 그림 · 소리 · 글꼴은 일주일 동안 다시 받지 않게 (트래픽 절약)
    if request.headers.get("X-Forwarded-Proto", "").split(",")[0].strip() == "https":
        resp.headers["Strict-Transport-Security"] = "max-age=15552000"
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
