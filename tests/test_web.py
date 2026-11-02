"""KI득KI득 웹 서버 자동 테스트 (방 · 관전 · 재접속 · 랭킹 · 비공개 방 · 대기 줄 · 보안 · 비용)

실행: python -m unittest discover -s tests -v   (aiohttp가 없으면 건너뜀)
"""
import asyncio
import hashlib
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "web"))

try:
    from aiohttp import WSMsgType, web
    from aiohttp.test_utils import TestClient, TestServer
    os.environ["KIDK_RANKING_FILE"] = os.path.join(tempfile.mkdtemp(), "ranking.json")
    os.environ.pop("SUPABASE_URL", None)
    import ranking_store
    import server
except ImportError:  # 데스크톱판만 쓰는 PC
    server = None


# 진짜 칭호 코드는 저장소에 두지 않으므로 테스트 전용 코드를 서버에 넣어서 씀
TEST_CODES = {"TEST-DEV-CODE": "dev", "TEST-KDA-CODE": "kda", "TEST-ROOK-CODE": "chess_s5", "TEST-PIG-CODE": "yut_win"}


@unittest.skipIf(server is None, "aiohttp가 설치되어 있지 않음")
class WebServerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        os.environ["KIDK_RANKING_FILE"] = os.path.join(tempfile.mkdtemp(), "ranking.json")  # 테스트마다 빈 랭킹
        server.hub.__init__()
        server.TITLE_CODES.update({hashlib.sha256(code.encode()).hexdigest(): title for code, title in TEST_CODES.items()})
        self.pids = {}  # 테스트용 짧은 이름 -> 서버가 준 공개 번호
        self.client = TestClient(TestServer(server.make_app()))
        await self.client.start_server()

    @staticmethod
    def secret(cid):
        return cid.ljust(32, "0")  # 비밀 열쇠는 16자 이상이어야 함

    async def asyncTearDown(self):
        await self.client.close()

    async def connect(self, cid, name, avatar="fox", headers=None):
        ws = await self.client.ws_connect(f"/ws?cid={self.secret(cid)}", headers=headers)
        welcome = await ws.receive_json()
        self.assertEqual(welcome["t"], "welcome")
        self.pids[cid] = welcome["pid"]
        await ws.send_json({"t": "profile", "profile": {"name": name, "avatar": avatar, "intro": "ENFP"}})
        return ws

    async def until(self, ws, t):
        """원하는 종류의 메시지가 올 때까지 읽음."""
        while True:
            msg = await asyncio.wait_for(ws.receive_json(), 2)
            if msg["t"] == t:
                return msg

    async def test_index_and_static(self):
        for path in ("/", "/js/app.js", "/style.css", "/fonts/Jua-Regular.ttf", "/healthz"):
            resp = await self.client.get(path)
            self.assertEqual(resp.status, 200, path)

    async def test_new_tab_tells_old_tab_it_was_replaced(self):
        old = await self.connect("aaaaaaaa1", "태고")
        new = await self.connect("aaaaaaaa1", "태고")
        # 옛 탭은 이 코드를 보고 자동으로 다시 붙지 않음 (탭끼리 밀어내기 방지)
        # close_code는 답장을 보내다 실패하면 덮어써지므로, 서버가 보낸 닫기 메시지를 직접 확인
        msg = await asyncio.wait_for(old.receive(), 15)
        while msg.type is WSMsgType.TEXT:
            msg = await asyncio.wait_for(old.receive(), 15)
        self.assertEqual((msg.type, msg.data), (WSMsgType.CLOSE, 4001))
        await new.close()

    async def test_room_flow(self):
        a = await self.connect("aaaaaaaa1", "태고")
        b = await self.connect("bbbbbbbb2", "민수")
        await a.send_json({"t": "create", "game": "omok", "settings": {"rule": "33"}})
        room = (await self.until(a, "room"))["room"]
        self.assertEqual(len(room["id"]), 4)

        await b.send_json({"t": "join", "room": room["id"].lower()})  # 소문자로 넣어도 들어가짐
        room = (await self.until(b, "room"))["room"]
        self.assertEqual([m["role"] for m in room["members"]], ["player", "player"])

        # 방장이 아닌 사람은 시작할 수 없음
        await b.send_json({"t": "act", "a": {"type": "start"}})
        await a.send_json({"t": "act", "a": {"type": "start", "game": "omok"}})
        start = await self.until(b, "act")
        self.assertEqual((start["a"]["type"], start["from"]), ("start", self.pids["aaaaaaaa1"]))

        await a.send_json({"t": "act", "a": {"type": "place", "r": 7, "c": 7}})
        move = await self.until(b, "act")
        self.assertEqual((move["a"]["r"], move["seq"]), (7, start["seq"] + 1))
        self.assertIn("at", move)

        # 세 번째 사람은 진행 중인 방에 관전자로 들어가고, 지금까지의 수를 받음
        c = await self.connect("cccccccc3", "지수")
        await c.send_json({"t": "join", "room": room["id"]})
        room = (await self.until(c, "room"))["room"]
        self.assertEqual(room["members"][-1]["role"], "spectator")
        log = await self.until(c, "log")
        self.assertEqual([e["a"]["type"] for e in log["acts"]], ["start", "place"])

        # 관전자의 수는 무시됨
        await c.send_json({"t": "act", "a": {"type": "place", "r": 0, "c": 0}})
        await c.send_json({"t": "chat", "text": "  화이팅  "})
        chat = await self.until(a, "chat")
        self.assertEqual(chat["text"], "화이팅")

        # 재접속: 같은 cid로 다시 붙으면 방과 기록을 다시 받음
        await b.close()
        b = await self.client.ws_connect(f"/ws?cid={self.secret('bbbbbbbb2')}")
        welcome = await b.receive_json()
        self.assertEqual(welcome["room"]["id"], room["id"])
        log = await self.until(b, "log")
        self.assertEqual(len(log["acts"]), 2)

        await a.send_json({"t": "result", "players": ["태고", "민수"], "winners": ["태고"]})
        await a.send_json({"t": "ranking"})
        rank = (await self.until(a, "ranking"))["ranking"]
        self.assertEqual(rank["태고"]["omok"], {"wins": 1, "games": 1})
        self.assertEqual(rank["민수"]["omok"], {"wins": 0, "games": 1})
        for ws in (a, b, c):
            await ws.close()

    async def test_player_leaving_mid_game_counts_as_leave(self):
        a = await self.connect("aaaaaaaa1", "태고")
        b = await self.connect("bbbbbbbb2", "민수")
        await a.send_json({"t": "create", "game": "chess"})
        room = (await self.until(a, "room"))["room"]
        await b.send_json({"t": "join", "room": room["id"]})
        await self.until(b, "room")
        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})
        await self.until(b, "act")
        await self.until(a, "act")  # 방장도 자기 start를 돌려받음
        await b.send_json({"t": "leave"})
        leave = await self.until(a, "act")
        self.assertEqual((leave["a"]["type"], leave["from"]), ("leave", self.pids["bbbbbbbb2"]))
        await a.close()
        await b.close()

    async def two_players(self, game, settings=None):
        """방장 a + 참가자 b가 game 방에 앉은 상태. (a, b, 방 코드)"""
        a = await self.connect("aaaaaaaa1", "태고")
        b = await self.connect("bbbbbbbb2", "민수")
        await a.send_json({"t": "create", "game": game, "settings": settings or {}})
        room = (await self.until(a, "room"))["room"]
        await b.send_json({"t": "join", "room": room["id"]})
        await self.until(b, "room")
        return a, b, room["id"]

    async def start(self, a, b, game):
        await a.send_json({"t": "act", "a": {"type": "start", "game": game}})
        await self.until(a, "act")
        await self.until(b, "act")

    async def quiet(self, ws):
        """보낸 것이 무시됐는지 확인: ping을 보내 다음 메시지가 바로 pong인지 봄."""
        await ws.send_json({"t": "ping", "c": 1})
        while True:
            msg = await asyncio.wait_for(ws.receive_json(), 2)
            if msg["t"] in ("act", "pong"):
                return msg["t"]

    async def test_private_room_is_hidden_but_joinable_by_code(self):
        a = await self.connect("aaaaaaaa1", "태고")
        await a.send_json({"t": "create", "game": "chess", "settings": {"private": "1"}})
        room = (await self.until(a, "room"))["room"]
        c = await self.connect("cccccccc3", "지수")
        await c.send_json({"t": "rooms"})
        self.assertEqual((await self.until(c, "rooms"))["rooms"], [])
        await c.send_json({"t": "join", "room": room["id"]})
        joined = (await self.until(c, "room"))["room"]
        self.assertEqual(joined["id"], room["id"])
        for ws in (a, c):
            await ws.close()

    async def test_server_rolls_yacht_dice(self):
        a, b, _ = await self.two_players("yacht")
        await self.start(a, b, "yacht")
        rolls = []
        for _ in range(2):
            await a.send_json({"t": "act", "a": {"type": "roll", "dice": [6, 6, 6, 6, 6]}})
            rolls.append((await self.until(a, "act"))["a"]["dice"])
        for dice in rolls:
            self.assertEqual(len(dice), 5)
            self.assertTrue(all(1 <= v <= 6 for v in dice))
        self.assertNotEqual(rolls, [[6] * 5, [6] * 5])  # 보낸 값이 아니라 서버가 굴린 값 (두 번 다 6 야추일 확률은 거의 0)
        for ws in (a, b):
            await ws.close()

    async def test_server_seeds_yut_acts(self):
        a, b, _ = await self.two_players("yut", {"pieces": "2", "chaos": "chaos"})
        await a.send_json({"t": "act", "a": {"type": "start", "game": "yut"}})
        starts = [(await self.until(ws, "act"))["a"] for ws in (a, b)]
        self.assertEqual(starts[0]["seed"], starts[1]["seed"])  # 시작 카드도 모두 같은 씨앗으로 나눔
        await a.send_json({"t": "act", "a": {"type": "throw", "seed": 1}})
        seeds = [(await self.until(ws, "act"))["a"]["seed"] for ws in (a, b)]
        self.assertEqual(seeds[0], seeds[1])  # 모든 기기가 같은 seed를 받음
        self.assertIsInstance(seeds[0], int)
        self.assertNotEqual(seeds[0], 1)  # 보낸 값이 아니라 서버가 정한 값 (우연히 1일 확률은 거의 0)
        for ws in (a, b):
            await ws.close()

    async def test_yut_character_only_changes_own(self):
        a, b, _ = await self.two_players("yut")
        await self.until(a, "room")  # 방장 쪽에 남은 참가 알림을 먼저 비움
        # 방장이 pid로 남을 지정해도 본인 말만 바뀌고, 참가자도 마찬가지
        await a.send_json({"t": "yut_skin", "pid": self.pids["bbbbbbbb2"], "skin": "rabbit"})
        room = (await self.until(b, "room"))["room"]
        skins = {m["cid"]: m["yut_skin"] for m in room["members"]}
        self.assertEqual(skins, {self.pids["aaaaaaaa1"]: "rabbit", self.pids["bbbbbbbb2"]: ""})
        await b.send_json({"t": "yut_skin", "pid": self.pids["aaaaaaaa1"], "skin": "penguin"})
        room = (await self.until(a, "room"))["room"]
        while room["members"][1]["yut_skin"] != "penguin":
            room = (await self.until(a, "room"))["room"]
        self.assertEqual(room["members"][0]["yut_skin"], "rabbit")
        await a.close()
        await b.close()

    async def test_host_cannot_pick_other_team_character(self):
        a, b, _ = await self.two_players("yut", {"team": "1"})
        await a.send_json({"t": "yut_team_skin", "team": "B", "skin": "penguin"})  # a는 A팀
        await a.send_json({"t": "ping", "c": 83})
        self.assertEqual((await self.until(a, "pong"))["c"], 83)
        await a.send_json({"t": "yut_team_skin", "team": "A", "skin": "tiger"})
        room = (await self.until(a, "room"))["room"]
        self.assertEqual(room["team_skins"], {"A": "tiger", "B": ""})
        await a.close()
        await b.close()

    async def test_host_can_hand_over_host(self):
        a, b, _ = await self.two_players("omok")
        await b.send_json({"t": "host", "pid": self.pids["bbbbbbbb2"]})  # 방장이 아니면 무시
        await b.send_json({"t": "ping", "c": 84})
        self.assertEqual((await self.until(b, "pong"))["c"], 84)
        await a.send_json({"t": "host", "pid": self.pids["bbbbbbbb2"]})
        notice = await self.until(b, "notice")
        while notice["kind"] != "host":
            notice = await self.until(b, "notice")
        self.assertEqual(notice["name"], "민수")
        room = (await self.until(b, "room"))["room"]
        self.assertEqual(room["host"], self.pids["bbbbbbbb2"])
        await a.send_json({"t": "kick", "pid": self.pids["bbbbbbbb2"]})  # 넘긴 뒤에는 권한 없음
        await a.send_json({"t": "ping", "c": 85})
        self.assertEqual((await self.until(a, "pong"))["c"], 85)
        await b.send_json({"t": "ping", "c": 86})
        msg = await asyncio.wait_for(b.receive_json(), 2)
        while msg["t"] != "pong":
            self.assertNotEqual(msg["t"], "kicked")
            msg = await asyncio.wait_for(b.receive_json(), 2)
        await a.close()
        await b.close()

    async def test_host_can_kick_player_during_game(self):
        a, b, code = await self.two_players("omok")
        await self.start(a, b, "omok")
        await a.send_json({"t": "kick", "pid": self.pids["bbbbbbbb2"]})
        self.assertEqual((await self.until(b, "kicked"))["room"], code)
        act = await self.until(a, "act")  # 게임은 그 사람이 나간 것으로 처리
        self.assertEqual((act["a"]["type"], act["from"]), ("leave", self.pids["bbbbbbbb2"]))
        await a.close()
        await b.close()

    async def test_yut_team_shares_one_character(self):
        a, b, _ = await self.two_players("yut", {"team": "1"})
        await self.until(a, "room")  # 방장 쪽에 남은 참가 알림을 먼저 비움
        await b.send_json({"t": "yut_team_skin", "team": "A", "skin": "penguin"})  # b는 B팀이라 A팀 말은 못 고름
        await b.send_json({"t": "ping", "c": 82})
        self.assertEqual((await self.until(b, "pong"))["c"], 82)
        await a.send_json({"t": "yut_team_skin", "team": "A", "skin": "tiger"})
        room = (await self.until(a, "room"))["room"]
        self.assertEqual(room["team_skins"], {"A": "tiger", "B": ""})
        await self.until(b, "room")
        await b.send_json({"t": "yut_team_skin", "team": "B", "skin": "tiger"})  # 상대 팀과 같은 말은 안 됨
        await b.send_json({"t": "yut_team_skin", "team": "B", "skin": "rabbit"})
        room = (await self.until(b, "room"))["room"]
        self.assertEqual(room["team_skins"], {"A": "tiger", "B": "rabbit"})
        await a.close()
        await b.close()

    async def test_yut_host_can_choose_own_character(self):
        a, b, _ = await self.two_players("yut")
        await self.until(a, "room")  # 방장 쪽에 참가 알림으로 전송된 최신 방 정보를 비움
        await a.send_json({"t": "yut_skin", "skin": "penguin"})
        room = (await self.until(a, "room"))["room"]
        host = next(member for member in room["members"] if member["cid"] == self.pids["aaaaaaaa1"])
        self.assertEqual(host["yut_skin"], "penguin")
        await a.close()
        await b.close()

    async def test_title_code_gives_token_and_shows_only_with_valid_token(self):
        a = await self.connect("aaaaaaaa1", "태고")
        await a.send_json({"t": "redeem", "code": "wrong-code"})
        self.assertEqual((await self.until(a, "title_bad"))["t"], "title_bad")
        await a.send_json({"t": "redeem", "code": " test-kda-code "})
        grant = await self.until(a, "title_grant")
        self.assertEqual(grant["title"], "kda")
        # 표 없이 칭호를 달겠다고 하면 무시
        await a.send_json({"t": "profile", "profile": {"name": "태고", "title": "dev", "titleToken": grant["token"]}})
        await a.send_json({"t": "create", "game": "chess", "settings": {}})
        room = (await self.until(a, "room"))["room"]
        self.assertNotIn("title", room["members"][0])
        # 받은 표로 달면 방 사람들에게 보임
        await a.send_json({"t": "profile", "profile": {"name": "태고", "title": "kda", "titleToken": grant["token"]}})
        room = (await self.until(a, "room"))["room"]
        self.assertEqual(room["members"][0]["title"], "kda")
        await a.close()

    async def test_finished_game_grants_win_lose_and_spectator_titles(self):
        a, b, code = await self.two_players("chess")
        c = await self.connect("cccccccc3", "구경꾼")
        await c.send_json({"t": "join", "room": code})
        await self.until(c, "room")

        async def titles_of(ws, count):
            return {(await self.until(ws, "title_grant"))["title"] for _ in range(count)}

        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})
        await self.until(a, "act")
        await a.send_json({"t": "result", "winners": ["태고"], "losers": ["민수"]})
        got = await titles_of(a, 3)
        self.assertLessEqual({"first_game", "first_win"}, got)
        self.assertEqual(await titles_of(b, 1), {"first_game"})
        self.assertEqual(await titles_of(c, 1), {"spectator"})
        for ws in (a, b, c):
            await ws.close()

    async def test_teabag_titles_count_one_per_won_game(self):
        a, b, code = await self.two_players("chess")
        for game in range(3):
            await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})
            await self.until(a, "act")
            await a.send_json({"t": "result", "winners": ["태고"], "losers": ["민수"]})
            await self.until(a, "room")
            await b.send_json({"t": "fx", "fx": {"kind": "teabag"}})  # 진 사람은 세지 않음
            for _ in range(2):  # 같은 판에 여러 번 해도 한 판으로 셈
                await a.send_json({"t": "fx", "fx": {"kind": "teabag"}})
            grants = []
            while "teabag" not in grants:
                grants.append((await self.until(a, "title_grant"))["title"])
            if game < 2:
                await a.send_json({"t": "ranking"})  # 받을 것이 더 있으면 ranking보다 먼저 옴
                while (msg := await a.receive_json())["t"] != "ranking":
                    self.assertNotEqual(msg.get("title"), "teabag3")
            else:
                self.assertEqual((await self.until(a, "title_grant"))["title"], "teabag3")
            await a.send_json({"t": "reset"})
            await self.until(a, "reset")
        await a.close()
        await b.close()

    def test_win_titles_follow_streak_time_and_comeback(self):
        room = server.Room.__new__(server.Room)
        room.game, room.settings, room.started_at = "yut", {"team": "1", "chaos": "basic"}, 1000
        noon_kst = 1000 + 1800  # 시각 조건은 아래에서 따로 확인
        got = server.win_titles(room, 5, 3, now=noon_kst)
        for title in ("first_win", "yut_win", "yut_s2", "yut_s3", "yut_s5", "yut_team", "long_win", "comeback"):
            self.assertIn(title, got)
        for title in ("yut_s7", "yut_chaos", "fast_win"):
            self.assertNotIn(title, got)
        self.assertLessEqual(set(got), server.TITLE_IDS)
        room.started_at = 14 * 3600  # 23:00 KST (UTC 14시)
        self.assertIn("night_win", server.win_titles(room, 1, 0, now=14 * 3600 + 30))
        room.started_at = 18 * 3600  # 03:00 KST (UTC 18시)
        self.assertIn("night_win", server.win_titles(room, 1, 0, now=18 * 3600 + 30))
        self.assertNotIn("night_win", server.win_titles(room, 1, 0, now=6 * 3600))

    async def test_same_nickname_blocked_and_reserved_name_replaced(self):
        a, b, code = await self.two_players("chess")
        c = await self.connect("cccccccc3", "민 수")  # 띄어쓰기만 다른 같은 이름
        await c.send_json({"t": "join", "room": code})
        self.assertIn("같은 닉네임", (await self.until(c, "error"))["msg"])
        await b.send_json({"t": "profile", "profile": {"name": "태고"}})  # 방 안에서 남의 이름으로 못 바꿈
        await self.until(b, "error")
        d = await self.connect("dddddddd4", "D E V")
        await d.send_json({"t": "create", "game": "chess", "settings": {}})
        room = (await self.until(d, "room"))["room"]
        self.assertEqual(room["members"][0]["name"], "플레이어")
        for ws in (a, b, c, d):
            await ws.close()

    async def test_every_title_code_gives_its_title(self):
        a = await self.connect("aaaaaaaa1", "태고")
        self.assertEqual(set(server.TITLE_CODES.values()), server.TITLE_IDS)  # 모든 칭호에 코드가 있음
        for code, title in {"test-dev-code": "dev", "TEST-KDA-CODE": "kda", "TEST-ROOK-CODE": "chess_s5", "TEST-PIG-CODE": "yut_win"}.items():
            await a.send_json({"t": "redeem", "code": code})
            self.assertEqual((await self.until(a, "title_grant"))["title"], title)
        await asyncio.sleep(0)
        await a.close()

    async def test_title_backup_code_restores_on_another_browser(self):
        a = await self.connect("aaaaaaaa1", "태고")
        await a.send_json({"t": "redeem", "code": "TEST-KDA-CODE"})
        token = (await self.until(a, "title_grant"))["token"]
        await a.send_json({"t": "title_backup", "title": "kda", "token": "wrong"})  # 가짜 표는 무시
        await a.send_json({"t": "title_backup", "title": "kda", "token": token})
        code = (await self.until(a, "title_code"))["code"]
        b = await self.connect("bbbbbbbb2", "민수")
        await b.send_json({"t": "redeem", "code": code.lower()})
        self.assertEqual((await self.until(b, "title_grant"))["title"], "kda")
        await b.send_json({"t": "redeem", "code": code[:-1] + ("0" if code[-1] != "0" else "1")})  # 고친 코드는 안 됨
        await self.until(b, "title_bad")
        for ws in (a, b):
            await ws.close()

    async def test_host_can_act_only_for_offline_player(self):
        a, b, _ = await self.two_players("yacht")
        await self.start(a, b, "yacht")
        await a.send_json({"t": "act", "a": {"type": "hold", "i": 0}, "as": self.pids["bbbbbbbb2"]})  # b는 접속 중 → 무시
        self.assertEqual(await self.quiet(a), "pong")
        await b.close()
        await asyncio.sleep(0.2)
        await a.send_json({"t": "act", "a": {"type": "hold", "i": 0}, "as": self.pids["bbbbbbbb2"]})
        entry = await self.until(a, "act")
        self.assertEqual(entry["from"], self.pids["bbbbbbbb2"])
        await a.send_json({"t": "act", "a": {"type": "resign"}, "as": self.pids["bbbbbbbb2"]})  # 대신 항복은 못 함
        self.assertEqual(await self.quiet(a), "pong")
        await a.close()

    async def test_ranking_only_counts_seated_names(self):
        a, b, _ = await self.two_players("chess")
        await self.start(a, b, "chess")
        await a.send_json({"t": "result", "players": ["태고", "민수", "가짜"], "winners": ["태고", "가짜"]})
        await a.send_json({"t": "ranking"})
        rank = (await self.until(a, "ranking"))["ranking"]
        self.assertEqual(sorted(rank), ["민수", "태고"])
        self.assertEqual(rank["태고"]["chess"], {"wins": 1, "games": 1})
        for ws in (a, b):
            await ws.close()

    async def test_queue_rotates_loser_and_counts_streak(self):
        a, b, code = await self.two_players("chess")
        c = await self.connect("cccccccc3", "지수")
        await c.send_json({"t": "join", "room": code})  # 꽉 찬 방 → 줄을 섬
        room = (await self.until(c, "room"))["room"]
        self.assertEqual(room["queue"], [self.pids["cccccccc3"]])

        for winner, loser, expect_streak in (("민수", "태고", 1), ("민수", "지수", 2)):  # 방장(태고)이 져서 줄로 가도 시작 가능
            await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})
            await self.until(a, "act")
            await a.send_json({"t": "result", "winners": [winner], "losers": [loser]})
            room = (await self.until(a, "room"))["room"]
            streak = {m["name"]: m["streak"] for m in room["members"]}
            self.assertEqual(streak["민수"], expect_streak)
            await a.send_json({"t": "reset"})
            room = (await self.until(a, "room"))["room"]
            roles = {m["name"]: m["role"] for m in room["members"]}
            self.assertEqual(roles[loser], "spectator")  # 진 사람은 줄 맨 뒤로
            self.assertEqual(sum(r == "player" for r in roles.values()), 2)
            self.assertEqual(room["queue"], [next(m["cid"] for m in room["members"] if m["name"] == loser)])

        await a.send_json({"t": "rooms"})
        summary = (await self.until(a, "rooms"))["rooms"][0]
        self.assertEqual(summary["king"], {"name": "민수", "streak": 2})
        for ws in (a, b, c):
            await ws.close()

    async def test_secret_id_is_never_shown_to_others(self):
        a, b, code = await self.two_players("omok")
        await b.send_json({"t": "chat", "text": "안녕"})
        chat = await self.until(a, "chat")
        self.assertEqual(chat["from"], self.pids["bbbbbbbb2"])
        await a.send_json({"t": "rooms"})
        await b.send_json({"t": "seat", "role": "spectator"})
        room = (await self.until(a, "room"))["room"]
        dump = str(room)
        self.assertNotIn(self.secret("aaaaaaaa1"), dump)
        self.assertNotIn(self.secret("bbbbbbbb2"), dump)
        # 공개 번호를 알아도 그걸로 접속하면 남의 자리가 아니라 새 사람이 됨
        thief = await self.client.ws_connect(f"/ws?cid={self.pids['bbbbbbbb2'].ljust(32, 'x')}")
        welcome = await thief.receive_json()
        self.assertIsNone(welcome["room"])
        self.assertNotEqual(welcome["pid"], self.pids["bbbbbbbb2"])
        for ws in (a, b, thief):
            await ws.close()

    async def test_seats_are_built_by_server_in_host_order(self):
        a, b, _ = await self.two_players("chess")
        fake = [{"cid": "x", "name": "가짜 이름", "avatar": "data:image/png;base64,AAAA"}]
        order = [self.pids["bbbbbbbb2"], self.pids["aaaaaaaa1"]]  # 방장이 흑을 고른 경우
        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess", "seats": fake, "order": order}})
        start = await self.until(b, "act")
        seats = start["a"]["seats"]
        self.assertEqual([s["name"] for s in seats], ["민수", "태고"])
        self.assertEqual([s["cid"] for s in seats], order)
        self.assertNotIn("order", start["a"])
        for ws in (a, b):
            await ws.close()

    async def test_host_can_kick_and_kicked_cannot_return(self):
        a, b, code = await self.two_players("omok")
        await b.send_json({"t": "kick", "pid": self.pids["aaaaaaaa1"]})  # 방장이 아니면 무시
        await a.send_json({"t": "kick", "pid": self.pids["bbbbbbbb2"]})
        self.assertEqual((await self.until(b, "kicked"))["room"], code)
        room = (await self.until(a, "room"))["room"]
        while len(room["members"]) > 1:  # 내보내기 전에 쌓인 방 정보는 건너뜀
            room = (await self.until(a, "room"))["room"]
        self.assertEqual([m["name"] for m in room["members"]], ["태고"])
        await b.send_json({"t": "join", "room": code})
        self.assertIn("내보낸", (await self.until(b, "error"))["msg"])
        for ws in (a, b):
            await ws.close()

    async def test_big_or_unknown_payloads_are_dropped(self):
        a, b, _ = await self.two_players("omok")
        await self.start(a, b, "omok")
        await a.send_json({"t": "act", "a": {"type": "place", "junk": "x" * 5000}})  # 너무 큼
        self.assertEqual(await self.quiet(a), "pong")
        await a.send_json({"t": "fx", "fx": {"kind": "virus", "data": "x"}})  # 모르는 효과
        await a.send_json({"t": "fx", "fx": {"kind": "taunt", "seat": 0, "text": "킹받쥬?" * 20, "junk": 1}})
        fx = await self.until(b, "fx")
        self.assertEqual(fx["fx"], {"kind": "taunt", "seat": 0, "text": ("킹받쥬?" * 20)[:40]})
        for ws in (a, b):
            await ws.close()

    async def test_photos_are_sent_once_not_in_every_room_update(self):
        photo = "data:image/jpeg;base64," + "A" * 3000
        a = await self.connect("aaaaaaaa1", "태고", avatar=photo)
        await a.send_json({"t": "create", "game": "yacht"})
        room = (await self.until(a, "room"))["room"]
        self.assertTrue(room["members"][0]["avatar"].startswith(f"photo:{self.pids['aaaaaaaa1']}:"))
        self.assertNotIn("base64", str(room))
        b = await self.connect("bbbbbbbb2", "민수")
        await b.send_json({"t": "join", "room": room["id"]})
        photos = (await self.until(b, "photos"))["photos"]
        self.assertEqual(photos, {self.pids["aaaaaaaa1"]: photo})
        for ws in (a, b):
            await ws.close()

    async def test_connection_limit_per_address(self):
        old = server.MAX_PER_IP
        server.MAX_PER_IP = 2
        try:
            a = await self.connect("aaaaaaaa1", "태고")
            b = await self.connect("bbbbbbbb2", "민수")
            with self.assertRaises(Exception):  # 세 번째는 거절 (429)
                await self.connect("cccccccc3", "지수")
            again = await self.client.ws_connect(f"/ws?cid={self.secret('aaaaaaaa1')}")  # 이미 있던 사람의 재접속은 허용
            self.assertEqual((await again.receive_json())["t"], "welcome")
            for ws in (a, b, again):
                await ws.close()
        finally:
            server.MAX_PER_IP = old

    async def test_other_sites_cannot_open_socket(self):
        with self.assertRaises(Exception):
            await self.client.ws_connect(f"/ws?cid={self.secret('aaaaaaaa1')}", headers={"Origin": "https://evil.example"})
        host = f"{self.client.host}:{self.client.port}"
        ws = await self.client.ws_connect(f"/ws?cid={self.secret('aaaaaaaa1')}", headers={"Origin": f"http://{host}"})
        self.assertEqual((await ws.receive_json())["t"], "welcome")
        await ws.close()

    async def test_security_headers_and_qr(self):
        resp = await self.client.get("/")
        self.assertIn("frame-ancestors 'none'", resp.headers["Content-Security-Policy"])
        self.assertEqual(resp.headers["X-Content-Type-Options"], "nosniff")
        qr = await self.client.get("/qr/AB2C.svg")
        self.assertEqual(qr.status, 200)
        self.assertIn("<svg", await qr.text())
        self.assertEqual((await self.client.get("/qr/HELLO.svg")).status, 404)
        self.assertEqual((await self.client.get("/qr/AB0C.svg")).status, 404)  # 방 코드에 없는 글자

    async def test_idle_connections_are_closed(self):
        a = await self.connect("aaaaaaaa1", "태고")
        await asyncio.sleep(0.2)  # 프로필 메시지가 먼저 처리되도록
        server.hub.clients[self.secret("aaaaaaaa1")].last_active -= server.IDLE_LOBBY + 1
        reaper = asyncio.ensure_future(server.hub.reap_idle(interval=0.05))
        try:
            await asyncio.wait_for(a.receive(), 5)
            self.assertEqual(a.close_code, 4000)
        finally:
            reaper.cancel()
        await a.close()

    async def test_chat_flood_is_dropped(self):
        a, b, _ = await self.two_players("omok")
        for k in range(20):
            await a.send_json({"t": "chat", "text": f"도배{k}"})
        got = []
        while True:
            try:
                msg = await asyncio.wait_for(b.receive_json(), 0.5)
            except asyncio.TimeoutError:
                break
            if msg["t"] == "chat":
                got.append(msg["text"])
        self.assertEqual(len(got), server.RATE_CHAT)
        for ws in (a, b):
            await ws.close()

    async def test_profile_is_cleaned(self):
        p = server.clean_profile({"name": "  아주아주아주아주긴닉네임입니다  ", "avatar": "<script>", "intro": "x" * 99})
        self.assertEqual((len(p["name"]), p["avatar"], len(p["intro"])), (12, "cat", 30))
        for avatar in ("penguin", "tiger"):
            self.assertEqual(server.clean_profile({"name": "윷 플레이어", "avatar": avatar})["avatar"], avatar)
        self.assertIsNone(server.clean_profile({"name": "   "}))


@unittest.skipIf(server is None, "aiohttp가 설치되어 있지 않음")
class SupabaseStoreTest(unittest.IsolatedAsyncioTestCase):
    """가짜 Supabase(PostgREST)를 띄워서 서버가 보내는 요청 모양을 확인."""

    async def asyncSetUp(self):
        self.calls = []

        async def rpc(request):
            self.calls.append((request.headers.get("apikey"), await request.json()))
            return web.Response(status=204)

        async def table(request):
            self.calls.append((request.headers.get("Authorization"), dict(request.query)))
            return web.json_response([{"name": "태고", "game": "yacht", "wins": 3, "games": 5},
                                      {"name": "민수", "game": "bingo", "wins": 1, "games": 1}])

        app = web.Application()
        app.router.add_post("/rest/v1/rpc/kidk_add_result", rpc)
        app.router.add_get("/rest/v1/kidk_ranking", table)
        self.fake = TestServer(app)
        await self.fake.start_server()
        self.store = ranking_store.SupabaseStore(str(self.fake.make_url("")), "service-key")

    async def asyncTearDown(self):
        await self.store.close()
        await self.fake.close()

    async def test_add_and_read(self):
        await self.store.add("yacht", ["태고", "민수"], ["태고"])
        self.assertEqual(self.calls[0], ("service-key", {"p_game": "yacht", "p_players": ["태고", "민수"],
                                                         "p_winners": ["태고"]}))
        rank = await self.store.all()
        self.assertEqual(rank, {"태고": {"yacht": {"wins": 3, "games": 5}}})  # 모르는 게임은 버림
        self.assertEqual(self.calls[1][0], "Bearer service-key")
        await self.store.all()  # 10초 안에는 다시 부르지 않음
        self.assertEqual(len(self.calls), 2)

    async def test_env_picks_store(self):
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"] = "https://x.supabase.co", "k"
        try:
            store = ranking_store.make_store("unused.json")
            self.assertEqual(store.kind, "supabase")
            await store.close()
        finally:
            del os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
        self.assertEqual(ranking_store.make_store(os.path.join(tempfile.mkdtemp(), "r.json")).kind, "file")


if __name__ == "__main__":
    unittest.main()
