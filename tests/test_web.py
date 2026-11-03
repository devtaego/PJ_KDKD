"""KI득KI득 웹 서버 자동 테스트 (방 · 관전 · 재접속 · 랭킹 · 비공개 방 · 대기 줄 · 보안 · 비용)

실행: python -m unittest discover -s tests -v   (aiohttp가 없으면 건너뜀)
"""
import asyncio
import hashlib
import json
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
        # 시간 · 묶어 보내기 조건은 그 기능을 시험하는 테스트에서만 켬
        server.MIN_GAME_SECONDS = 0
        server.ROOM_SEND_INTERVAL = 0
        server.ROOMS_SEND_INTERVAL = 0
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
        await a.send_json({"t": "create", "game": "omok", "settings": {"rule": "renju"}})
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

        await self.finish(a, b, ["태고"])
        rank = await self.ranking_of(a)
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

    async def finish(self, a, b, winners, losers=None):
        """앉은 두 사람이 같은 결과를 보내 판을 끝냄. 끝난 방 정보를 돌려줌."""
        body = {"t": "result", "winners": winners, "losers": losers or []}
        await a.send_json(body)
        await b.send_json(body)
        room = (await self.until(a, "room"))["room"]
        while room["status"] != "done":
            room = (await self.until(a, "room"))["room"]
        return room

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

    async def test_all_titles_code_unlocks_everything_except_dev(self):
        real = server.ALL_TITLES_CODE
        server.ALL_TITLES_CODE = hashlib.sha256(b"TEST-ALL-CODE").hexdigest()
        self.addCleanup(setattr, server, "ALL_TITLES_CODE", real)
        a = await self.connect("aaaaaaaa1", "태고")
        await a.send_json({"t": "redeem", "code": " test-all-code "})  # 대소문자 · 공백 상관없음
        msg = await self.until(a, "title_grant_all")
        self.assertEqual(set(msg["titles"]), server.TITLE_IDS - {"dev", "real_sua"})  # 코드 전용 칭호는 빠짐
        for title, token in msg["titles"].items():
            self.assertEqual(token, server.title_token(self.secret("aaaaaaaa1"), title))
        await a.close()

    async def test_all_titles_code_is_off_without_server_setting(self):
        self.addCleanup(setattr, server, "ALL_TITLES_CODE", server.ALL_TITLES_CODE)
        server.ALL_TITLES_CODE = ""
        a = await self.connect("aaaaaaaa1", "태고")
        await a.send_json({"t": "redeem", "code": "TEST-ALL-CODE"})
        self.assertEqual((await self.until(a, "title_bad"))["t"], "title_bad")
        await a.close()

    async def play(self, a, b, winner):
        """둘이 한 판 하고 winner가 이김"""
        await self.start(a, b, "chess")
        return await self.finish(a, b, [winner])

    async def rows_of(self, ws):
        await ws.send_json({"t": "ranking"})
        return await self.until(ws, "ranking")

    async def test_same_name_is_not_merged_across_players(self):
        a, b, code = await self.two_players("chess")
        await self.play(a, b, "태고")
        await a.send_json({"t": "leave"})
        await self.until(b, "room")
        c = await self.connect("cccccccc3", "태고")  # 다른 브라우저의 같은 이름
        await b.send_json({"t": "reset"})
        await c.send_json({"t": "join", "room": code})
        await self.until(c, "room")
        await self.start(b, c, "chess")
        await self.finish(b, c, ["민수"])
        msg = await self.rows_of(b)
        same = sorted(r["games"]["chess"]["wins"] for r in msg["rows"] if r["name"] == "태고")
        self.assertEqual(same, [0, 1])  # 같은 이름이어도 두 줄
        self.assertEqual(msg["me"], server.player_id_for(self.secret("bbbbbbbb2")))
        self.assertNotIn(self.secret("aaaaaaaa1"), str(msg))  # 비밀 열쇠는 보이지 않음
        for ws in (a, b, c):
            await ws.close()

    async def test_reset_only_returns_to_waiting_room_and_never_starts(self):
        a, b, code = await self.two_players("chess")
        c = await self.connect("cccccccc3", "지수")
        await c.send_json({"t": "join", "room": code})
        await self.until(c, "room")
        await b.send_json({"t": "reset", "rematch": True})  # 아직 판이 안 끝났으면 무시
        await self.quiet(b)
        await self.start(a, b, "chess")
        await b.send_json({"t": "reset", "rematch": True})  # 게임 중에도 무시
        await self.quiet(b)
        await self.finish(a, b, ["민수"], ["태고"])
        await b.send_json({"t": "reset", "rematch": True})  # 예전 화면의 한 판 더도 대기실로만 돌려보냄
        await self._room_when(b, lambda r: r["status"] == "waiting")
        for ws in (a, b, c):
            await ws.close()

    async def _room_when(self, ws, ok):
        """조건에 맞는 방 정보가 올 때까지 기다림 (앞서 쌓인 방 정보는 건너뜀)"""
        while True:
            room = (await self.until(ws, "room"))["room"]
            if ok(room):
                return room

    async def _start_seats(self, ws):
        """다음 판 시작 메시지의 자리 이름 (첫 자리가 선공)"""
        while True:
            msg = await self.until(ws, "act")
            if msg["a"]["type"] == "start":
                return [s["name"] for s in msg["a"]["seats"]]

    async def test_only_host_starts_next_game_and_loser_moves_first(self):
        a, b, _ = await self.two_players("omok")
        await self.start(a, b, "omok")
        await self.finish(a, b, ["태고"], ["민수"])
        await b.send_json({"t": "act", "a": {"type": "start", "game": "omok"}})  # 방장이 아니면 시작 못 함
        await self.quiet(b)
        await a.send_json({"t": "act", "a": {"type": "start", "game": "omok"}})
        self.assertEqual(await self._start_seats(b), ["민수", "태고"])  # 진 사람이 선공
        await self.finish(a, b, ["민수"], ["태고"])
        await a.send_json({"t": "act", "a": {"type": "start", "game": "omok"}})
        self.assertEqual(await self._start_seats(b), ["태고", "민수"])
        for ws in (a, b):
            await ws.close()

    async def test_draw_keeps_seats_and_swaps_first_move(self):
        a, b, code = await self.two_players("chess")
        c = await self.connect("cccccccc3", "지수")
        await c.send_json({"t": "join", "room": code})
        await self.until(c, "room")
        await self.start(a, b, "chess")
        room = await self.finish(a, b, [])
        roles = {m["name"]: m["role"] for m in room["members"]}
        self.assertEqual((roles["태고"], roles["민수"], roles["지수"]), ("player", "player", "spectator"))
        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})
        self.assertEqual(await self._start_seats(b), ["민수", "태고"])  # 비기면 선공을 바꿈
        for ws in (a, b, c):
            await ws.close()

    def test_tournament_bracket_gives_byes_and_finds_champion(self):
        t = server.Tournament(list("abcde"))
        t.begin()
        self.assertEqual([len(r) for r in t.rounds], [4, 2, 1])
        byes = [m for m in t.rounds[0] if m["done"]]
        self.assertEqual(len(byes), 3)  # 5명이면 8칸 중 3칸이 부전승
        played = 0
        while t.current:
            match = t.match()
            self.assertTrue(match["a"] and match["b"])
            t.record(match["a"])
            played += 1
        self.assertEqual(played, 4)  # n명이면 n-1 경기
        self.assertEqual((t.stage, t.champion), ("finished", t.rounds[-1][0]["winner"]))

    def test_tournament_walkover_when_someone_leaves(self):
        t = server.Tournament(list("abcd"))
        t.begin()
        first, second = t.rounds[0]
        t.left.add(second["a"])  # 다음 경기 사람이 나가면 상대가 올라감
        t.advance()
        self.assertEqual((second["done"], second["winner"]), (True, second["b"]))
        self.assertEqual(t.current, (0, 0))
        self.assertFalse(t.record("nobody"))  # 경기에 없는 사람은 무시
        t.record(first["a"])
        self.assertEqual(t.current, (1, 0))

    async def _tournament_room(self):
        a = await self.connect("aaaaaaaa1", "태고")
        token = server.title_token(self.secret("aaaaaaaa1"), "dev")
        await a.send_json({"t": "create", "game": "chess", "settings": {}, "tournament": True, "devToken": token})
        room = (await self.until(a, "room"))["room"]
        return a, room

    async def test_only_dev_can_open_tournament(self):
        a = await self.connect("aaaaaaaa1", "태고")
        await a.send_json({"t": "create", "game": "chess", "tournament": True})
        self.assertIn("DEV", (await self.until(a, "error"))["msg"])
        other = server.title_token(self.secret("bbbbbbbb2"), "dev")  # 남의 표로는 안 됨
        await a.send_json({"t": "create", "game": "chess", "tournament": True, "devToken": other})
        self.assertIn("DEV", (await self.until(a, "error"))["msg"])
        kda = server.title_token(self.secret("aaaaaaaa1"), "kda")  # 다른 칭호 표로도 안 됨
        await a.send_json({"t": "create", "game": "chess", "tournament": True, "devToken": kda})
        self.assertIn("DEV", (await self.until(a, "error"))["msg"])
        dev = server.title_token(self.secret("aaaaaaaa1"), "dev")
        await a.send_json({"t": "create", "game": "yut", "tournament": True, "devToken": dev})  # 윷놀이는 1:1이 아님
        self.assertIn("토너먼트", (await self.until(a, "error"))["msg"])
        await a.close()

    async def test_tournament_runs_to_champion(self):
        a, room = await self._tournament_room()
        code = room["id"]
        self.assertEqual((room["tournament"]["stage"], room["tournament"]["entrants"]), ("signup", [self.pids["aaaaaaaa1"]]))
        b = await self.connect("bbbbbbbb2", "민수")
        c = await self.connect("cccccccc3", "지수")
        for ws in (b, c):
            await ws.send_json({"t": "join", "room": code})
            await self.until(ws, "room")
        await b.send_json({"t": "t_start"})  # 방장만 시작
        await self.quiet(b)
        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})  # 대회 시작 전에는 경기 못 함
        await a.send_json({"t": "t_start"})
        room = await self._room_when(a, lambda r: r["tournament"]["stage"] == "running")
        names = {self.pids[k]: n for k, n in (("aaaaaaaa1", "태고"), ("bbbbbbbb2", "민수"), ("cccccccc3", "지수"))}
        socks = {self.pids["aaaaaaaa1"]: a, self.pids["bbbbbbbb2"]: b, self.pids["cccccccc3"]: c}
        for _ in range(2):  # 3명이면 두 경기
            t = room["tournament"]
            match = t["rounds"][t["current"][0]][t["current"][1]]
            seated = {m["cid"] for m in room["members"] if m["role"] == "player"}
            self.assertEqual(seated, {match["a"], match["b"]})  # 지금 경기의 두 사람만 앉음
            await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})
            await self._start_seats(a)
            winner, loser = names[match["a"]], names[match["b"]]
            for pid in (match["a"], match["b"]):
                await socks[pid].send_json({"t": "result", "winners": [winner], "losers": [loser]})
            before = str(t["current"])
            room = await self._room_when(a, lambda r: r["status"] == "done" and str(r["tournament"]["current"]) != before)
        t = room["tournament"]
        self.assertEqual((t["stage"], t["current"]), ("finished", None))
        self.assertEqual(t["people"][t["champion"]]["name"], winner)
        self.assertEqual([m["role"] for m in room["members"]], ["spectator"] * 3)
        for ws in (a, b, c):
            await ws.close()

    async def test_eliminated_player_can_only_spectate(self):
        a, room = await self._tournament_room()
        b = await self.connect("bbbbbbbb2", "민수")
        c = await self.connect("cccccccc3", "지수")
        d = await self.connect("dddddddd4", "하늘")
        socks = {"aaaaaaaa1": a, "bbbbbbbb2": b, "cccccccc3": c, "dddddddd4": d}
        for ws in (b, c, d):
            await ws.send_json({"t": "join", "room": room["id"]})
            await self.until(ws, "room")
        await a.send_json({"t": "t_start"})
        room = await self._room_when(a, lambda r: r["tournament"]["stage"] == "running")
        t = room["tournament"]
        match = t["rounds"][0][t["current"][1]]
        by_pid = {self.pids[k]: ws for k, ws in socks.items()}
        await a.send_json({"t": "t_forfeit", "pid": match["a"]})  # b쪽이 탈락
        room = await self._room_when(a, lambda r: r["tournament"]["rounds"][0][0]["done"])
        loser = by_pid[match["b"]]
        await loser.send_json({"t": "seat", "role": "player"})  # 탈락한 사람은 자리에 앉을 수 없음
        await loser.send_json({"t": "seat", "role": "spectator"})
        room = await self._room_when(loser, lambda r: r["tournament"]["stage"] == "running" and r["tournament"]["rounds"][0][0]["done"])
        self.assertEqual({m["cid"]: m["role"] for m in room["members"]}[match["b"]], "spectator")
        self.assertIn(match["b"], room["tournament"]["entrants"])  # 명단과 대진표에는 남음
        for ws in socks.values():
            await ws.close()

    async def _tournament_final_titles(self):
        """2명 대회를 부전승으로 끝내고 민수가 받은 칭호 목록을 돌려줌"""
        a, room = await self._tournament_room()
        b = await self.connect("bbbbbbbb2", "민수")
        await b.send_json({"t": "join", "room": room["id"]})
        await self.until(b, "room")
        await a.send_json({"t": "t_start"})
        await self._room_when(a, lambda r: r["tournament"]["stage"] == "running")
        await a.send_json({"t": "t_forfeit", "pid": self.pids["bbbbbbbb2"]})
        await self._room_when(a, lambda r: r["tournament"]["stage"] == "finished")
        await b.send_json({"t": "ping", "c": 1})
        titles = []
        while True:
            msg = await asyncio.wait_for(b.receive_json(), 2)
            if msg["t"] == "pong":
                break
            if msg["t"] == "title_grant":
                titles.append(msg["title"])
        for ws in (a, b):
            await ws.close()
        return titles

    async def test_small_tournament_gives_no_champion_title(self):
        self.assertNotIn("t_champ", await self._tournament_final_titles())

    async def test_big_tournament_champion_gets_rare_title(self):
        self.addCleanup(setattr, server, "TOURNAMENT_TITLE_MIN", server.TOURNAMENT_TITLE_MIN)
        server.TOURNAMENT_TITLE_MIN = 2  # 8명을 다 붙이는 대신 기준을 낮춰서 확인
        self.assertIn("t_champ", await self._tournament_final_titles())

    async def test_tournament_draw_replays_and_host_can_give_walkover(self):
        a, room = await self._tournament_room()
        b = await self.connect("bbbbbbbb2", "민수")
        await b.send_json({"t": "join", "room": room["id"]})
        await self.until(b, "room")
        await a.send_json({"t": "t_start"})
        await self._room_when(a, lambda r: r["tournament"]["stage"] == "running")
        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})
        first = await self._start_seats(b)
        room = await self.finish(a, b, [])
        self.assertEqual(room["tournament"]["stage"], "running")  # 비기면 그대로
        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})
        self.assertEqual(await self._start_seats(b), first[::-1])  # 재경기는 선공을 바꿈
        await b.send_json({"t": "t_forfeit", "pid": self.pids["bbbbbbbb2"]})  # 방장만 할 수 있음
        await self.quiet(b)
        await a.send_json({"t": "t_forfeit", "pid": self.pids["bbbbbbbb2"]})  # 게임 중이어도 부전승으로 끝낼 수 있음
        room = await self._room_when(a, lambda r: r["tournament"]["stage"] == "finished")
        self.assertEqual(room["tournament"]["champion"], self.pids["bbbbbbbb2"])
        await a.send_json({"t": "t_reset"})
        room = await self._room_when(a, lambda r: r["tournament"]["stage"] == "signup")
        self.assertEqual(len(room["tournament"]["entrants"]), 2)
        for ws in (a, b):
            await ws.close()

    async def test_leaving_seat_ends_streak(self):
        a, b, _ = await self.two_players("chess")
        await self.start(a, b, "chess")
        room = await self.finish(a, b, ["민수"], ["태고"])
        self.assertEqual({m["name"]: m["streak"] for m in room["members"]}["민수"], 1)
        await b.send_json({"t": "seat", "role": "spectator"})  # 자리를 비우면 연승은 끝
        room = (await self.until(a, "room"))["room"]
        self.assertEqual({m["name"]: m["streak"] for m in room["members"]}["민수"], 0)
        for ws in (a, b):
            await ws.close()

    async def test_too_short_game_keeps_seats(self):
        server.MIN_GAME_SECONDS = 60
        a, b, code = await self.two_players("chess")
        c = await self.connect("cccccccc3", "지수")
        await c.send_json({"t": "join", "room": code})
        await self.until(c, "room")
        await self.start(a, b, "chess")
        room = await self.finish(a, b, ["태고"], ["민수"])
        roles = {m["name"]: m["role"] for m in room["members"]}
        self.assertEqual((roles["민수"], roles["지수"]), ("player", "spectator"))
        for ws in (a, b, c):
            await ws.close()

    async def test_changing_name_keeps_record(self):
        a, b, _ = await self.two_players("chess")
        await self.play(a, b, "태고")
        await a.send_json({"t": "reset"})
        await self.until(a, "reset")
        await a.send_json({"t": "profile", "profile": {"name": "새이름", "avatar": "fox"}})
        await self.until(a, "room")
        await self.play(a, b, "새이름")
        rows = (await self.rows_of(a))["rows"]
        mine = next(r for r in rows if r["id"] == server.player_id_for(self.secret("aaaaaaaa1")))
        self.assertEqual((mine["name"], mine["games"]["chess"]), ("새이름", {"wins": 2, "games": 2}))
        self.assertEqual(len(rows), 2)
        for ws in (a, b):
            await ws.close()

    async def test_record_code_moves_record_to_another_browser(self):
        a, b, code = await self.two_players("chess")
        await self.play(a, b, "태고")
        await a.send_json({"t": "record_code"})
        record = (await self.until(a, "record_code"))["code"]
        self.assertNotIn(self.secret("aaaaaaaa1"), record)
        new = await self.connect("dddddddd4", "태고폰")
        await new.send_json({"t": "redeem", "code": record.lower()})  # 대소문자 상관없음
        self.assertEqual((await self.until(new, "record_bind"))["code"], record)
        self.assertEqual(server.hub.clients[self.secret("dddddddd4")].player_id, server.player_id_for(self.secret("aaaaaaaa1")))
        await new.send_json({"t": "profile", "profile": {"name": "태고폰", "avatar": "fox", "recordCode": record}})
        await new.send_json({"t": "ping", "c": 7})
        await self.until(new, "pong")
        self.assertNotIn("recordCode", server.hub.clients[self.secret("dddddddd4")].profile)  # 남에게 보내는 프로필에는 없음
        # 틀린 코드는 안 통함
        wrong = record[:-1] + ("A" if record[-1] != "A" else "B")
        other = await self.connect("eeeeeeee5", "남")
        await other.send_json({"t": "redeem", "code": wrong})
        self.assertEqual((await self.until(other, "title_bad"))["t"], "title_bad")
        await other.send_json({"t": "profile", "profile": {"name": "남", "avatar": "fox", "recordCode": wrong}})
        await other.send_json({"t": "ping", "c": 8})
        await self.until(other, "pong")
        self.assertEqual(server.hub.clients[self.secret("eeeeeeee5")].player_id, server.player_id_for(self.secret("eeeeeeee5")))
        for ws in (a, b, new, other):
            await ws.close()

    async def test_same_player_on_both_seats_is_not_counted(self):
        a, b, _ = await self.two_players("chess")
        await a.send_json({"t": "record_code"})
        record = (await self.until(a, "record_code"))["code"]
        await b.send_json({"t": "redeem", "code": record})
        await self.until(b, "record_bind")
        await self.play(a, b, "태고")
        self.assertEqual((await self.rows_of(a))["rows"], [])
        for ws in (a, b):
            await ws.close()

    def test_old_file_ranking_becomes_legacy(self):
        path = os.path.join(tempfile.mkdtemp(), "r.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"옛사람": {"chess": {"wins": 3, "games": 4}}}, f, ensure_ascii=False)

        async def run():
            store = ranking_store.FileStore(path)
            await store.add("chess", [{"id": "AAA", "name": "옛사람"}, {"id": "BBB", "name": "상대"}], ["AAA"])
            return await ranking_store.FileStore(path).all()  # 다시 읽어도 유지

        rows = asyncio.run(run())
        legacy = next(r for r in rows if r["legacy"])
        self.assertEqual((legacy["name"], legacy["id"], legacy["games"]["chess"]["wins"]), ("옛사람", "", 3))
        fresh = next(r for r in rows if r["id"] == "AAA")
        self.assertEqual((fresh["legacy"], fresh["games"]["chess"]), (False, {"wins": 1, "games": 1}))

    async def test_cannot_start_alone(self):
        a = await self.connect("aaaaaaaa1", "태고")
        await a.send_json({"t": "create", "game": "chess", "settings": {}})
        await self.until(a, "room")
        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})
        await a.send_json({"t": "ping", "c": 1})
        self.assertEqual(await self.quiet(a), "pong")  # 시작되지 않음
        await a.close()

    async def ranking_of(self, ws):
        """이름으로 찾기 쉽게 {이름: {게임: 기록}}으로 바꿔서 돌려줌"""
        await ws.send_json({"t": "ranking"})
        return {row["name"]: row["games"] for row in (await self.until(ws, "ranking"))["rows"]}

    async def test_host_alone_cannot_decide_result(self):
        a, b, _ = await self.two_players("chess")
        await self.start(a, b, "chess")
        await a.send_json({"t": "result", "winners": ["태고"], "losers": ["민수"]})
        self.assertEqual(await self.ranking_of(a), {})  # 상대가 확인하기 전에는 기록 안 됨
        await b.send_json({"t": "result", "winners": ["민수"], "losers": ["태고"]})
        await b.send_json({"t": "ping", "c": 2})
        await self.until(b, "pong")
        self.assertEqual(await self.ranking_of(a), {})  # 결과가 다르면 기록 안 됨
        room = await self.finish(a, b, ["민수"], ["태고"])  # 다시 맞으면 기록
        self.assertEqual(room["status"], "done")
        self.assertEqual((await self.ranking_of(a))["민수"]["chess"], {"wins": 1, "games": 1})
        for ws in (a, b):
            await ws.close()

    async def test_last_one_left_can_finish_alone(self):
        a, b, _ = await self.two_players("chess")
        await self.start(a, b, "chess")
        await b.send_json({"t": "leave"})
        await self.until(a, "act")
        await a.send_json({"t": "result", "winners": ["태고"], "losers": ["민수"]})
        await a.send_json({"t": "ping", "c": 3})
        await self.until(a, "pong")
        self.assertEqual((await self.ranking_of(a))["태고"]["chess"]["wins"], 1)
        for ws in (a, b):
            await ws.close()

    async def test_too_short_game_is_not_counted(self):
        server.MIN_GAME_SECONDS = 60
        a, b, _ = await self.two_players("chess")
        await self.start(a, b, "chess")
        room = await self.finish(a, b, ["태고"], ["민수"])
        self.assertEqual(room["status"], "done")
        self.assertEqual({m["name"]: m["streak"] for m in room["members"]}["태고"], 0)
        self.assertEqual(await self.ranking_of(a), {})
        for ws in (a, b):
            await ws.close()

    async def test_opening_and_closing_cannot_fill_slots(self):
        old = server.MAX_PER_IP
        server.MAX_PER_IP = 3
        self.addCleanup(setattr, server, "MAX_PER_IP", old)
        for i in range(3):
            ws = await self.client.ws_connect(f"/ws?cid={'x' * 20}{i}")
            await ws.close()
        with self.assertRaises(Exception) as caught:  # 끊겨도 자리를 지키는 동안은 그 주소의 자리로 셈
            await self.client.ws_connect(f"/ws?cid={'x' * 20}9")
        self.assertEqual(caught.exception.status, 429)
        other = await self.client.ws_connect(f"/ws?cid={'y' * 20}", headers={"X-Forwarded-For": "9.9.9.9"})  # 다른 주소는 영향 없음
        self.assertEqual((await other.receive_json())["t"], "welcome")
        await other.close()

    async def test_room_has_member_cap(self):
        old = server.MAX_MEMBERS
        server.MAX_MEMBERS = 2
        self.addCleanup(setattr, server, "MAX_MEMBERS", old)
        a, b, code = await self.two_players("chess")
        c = await self.connect("cccccccc3", "지수")
        await c.send_json({"t": "join", "room": code, "as": "spectator"})
        self.assertIn("너무 많", (await self.until(c, "error"))["msg"])
        for ws in (a, b, c):
            await ws.close()

    async def test_photo_changes_in_room_are_limited_per_address(self):
        old = dict(server.IP_LIMITS)
        server.IP_LIMITS["photo"] = (1, 60)
        self.addCleanup(server.IP_LIMITS.update, old)
        a, b, _ = await self.two_players("chess")
        for n in "12":
            await a.send_json({"t": "profile", "profile": {"name": "태고", "avatar": "data:image/jpeg;base64," + n * 100}})
        await a.send_json({"t": "ping", "c": 4})
        await self.until(a, "pong")
        photos = (await self.until(b, "photos"))["photos"]
        self.assertTrue(next(iter(photos.values())).endswith("1" * 100))
        self.assertTrue(server.hub.clients[self.secret("aaaaaaaa1")].photo.endswith("1" * 100))  # 두 번째는 무시
        for ws in (a, b):
            await ws.close()

    async def test_big_photo_and_game_log_are_limited(self):
        self.assertIsNone(server.Client("x" * 16, "").photo)
        c = server.Client("x" * 16, "")
        c.set_profile({"name": "태고", "avatar": "data:image/jpeg;base64," + "A" * server.MAX_PHOTO})
        self.assertIsNone(c.photo)
        old = server.MAX_LOG_BYTES
        server.MAX_LOG_BYTES = 400
        self.addCleanup(setattr, server, "MAX_LOG_BYTES", old)
        a, b, code = await self.two_players("omok")
        await self.start(a, b, "omok")
        for r in range(8):
            await a.send_json({"t": "act", "a": {"type": "place", "r": r, "c": 0}})
            await self.until(b, "act")
        self.assertLess(server.hub.rooms[code].log_bytes, 400)
        for ws in (a, b):
            await ws.close()

    async def test_start_cannot_change_game_or_add_settings(self):
        a, b, _ = await self.two_players("chess")
        await a.send_json({"t": "act", "a": {"type": "start", "game": "constructor", "settings": {"time": "none", "evil": "x"}}})
        start = (await self.until(b, "act"))["a"]
        self.assertEqual(start["game"], "chess")
        self.assertEqual(start["settings"], {"time": "none"})
        for ws in (a, b):
            await ws.close()

    async def test_room_updates_are_grouped(self):
        server.ROOM_SEND_INTERVAL = 0.2
        a, b, code = await self.two_players("omok")
        await asyncio.sleep(0.3)
        for k in range(10):
            await a.send_json({"t": "settings", "settings": {"rule": "free" if k % 2 else "renju", "turn": str(k)}})
        await asyncio.sleep(0.5)
        rooms = []
        while True:
            try:
                msg = await asyncio.wait_for(b.receive_json(), 0.1)
            except asyncio.TimeoutError:
                break
            if msg["t"] == "room":
                rooms.append(msg["room"])
        self.assertLessEqual(len(rooms), 3)
        self.assertEqual(rooms[-1]["settings"]["turn"], "9")  # 마지막 상태는 빠지지 않음
        for ws in (a, b):
            await ws.close()

    async def test_secret_key_can_come_as_first_message(self):
        ws = await self.client.ws_connect("/ws")
        await ws.send_json({"t": "hello", "cid": self.secret("aaaaaaaa1")})
        welcome = await ws.receive_json()
        self.assertEqual((welcome["t"], welcome["cid"]), ("welcome", self.secret("aaaaaaaa1")))
        self.assertIn(self.secret("aaaaaaaa1"), server.hub.clients)
        await ws.close()
        old = server.HELLO_TIMEOUT
        server.HELLO_TIMEOUT = 0.05
        self.addCleanup(setattr, server, "HELLO_TIMEOUT", old)
        silent = await self.client.ws_connect("/ws")  # 열쇠를 안 보내면 끊김
        msg = await asyncio.wait_for(silent.receive(), 2)
        self.assertEqual(msg.data, 4002)
        await silent.close()

    def test_collection_titles_check_real_tokens(self):
        cid = "z" * 32
        token = lambda t: server.title_token(cid, t)  # noqa: E731
        base = sorted(server.COLLECT_TITLES)
        self.assertEqual(len(base), 37)  # DEV · 히든 제외 (titles.js의 COUNTED_TITLES와 같은 수)
        self.assertFalse({"dev", "q_about", "q_wrong", "col_all", "muso"} & set(base))
        self.assertEqual(server.collect_titles(cid, {t: "fake" for t in base}), [])  # 가짜 표는 세지 않음
        self.assertEqual(server.collect_titles(cid, {t: token(t) for t in base[:18]}), [])
        self.assertEqual(server.collect_titles(cid, {t: token(t) for t in base[:19]}), ["col_half"])
        self.assertEqual(server.collect_titles(cid, {t: token(t) for t in base[:30]}), ["col_half", "col_30"])
        full = {t: token(t) for t in base}
        self.assertEqual(server.collect_titles(cid, full), ["col_half", "col_30", "col_all"])
        self.assertEqual(server.collect_titles(cid, {**full, "reset_1": token("reset_1")})[-1], "nth_all")
        self.assertEqual(server.collect_titles(cid, full, resetting=True), ["muso"])
        self.assertEqual(server.collect_titles(cid, {t: token(t) for t in base[:30]}, resetting=True), [])

    async def test_collect_message_grants_titles(self):
        a = await self.connect("aaaaaaaa1", "태고")
        cid = self.secret("aaaaaaaa1")
        await a.send_json({"t": "collect", "tokens": {t: server.title_token(cid, t) for t in server.COLLECT_TITLES}})
        self.assertEqual({(await self.until(a, "title_grant"))["title"] for _ in range(3)}, {"col_half", "col_30", "col_all"})
        await a.close()

    async def test_chat_carries_only_verified_title(self):
        a, b, _ = await self.two_players("omok")
        await a.send_json({"t": "chat", "text": "칭호 없음"})
        self.assertEqual((await self.until(b, "chat"))["title"], "")
        # 다른 사람 표로는 칭호가 붙지 않음
        await a.send_json({"t": "profile", "profile": {"name": "태고", "title": "kda", "titleToken": server.title_token(self.secret("bbbbbbbb2"), "kda")}})
        await a.send_json({"t": "chat", "text": "남의 표"})
        self.assertEqual((await self.until(b, "chat"))["title"], "")
        await a.send_json({"t": "profile", "profile": {"name": "태고", "title": "kda", "titleToken": server.title_token(self.secret("aaaaaaaa1"), "kda")}})
        await a.send_json({"t": "chat", "text": "내 표"})
        chat = await self.until(b, "chat")
        self.assertEqual((chat["text"], chat["title"]), ("내 표", "kda"))
        for ws in (a, b):
            await ws.close()

    async def test_finished_game_grants_win_lose_and_spectator_titles(self):
        a, b, code = await self.two_players("chess")
        c = await self.connect("cccccccc3", "구경꾼")
        await c.send_json({"t": "join", "room": code})
        await self.until(c, "room")

        async def titles_of(ws, count):
            return {(await self.until(ws, "title_grant"))["title"] for _ in range(count)}

        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})
        await self.until(a, "act")
        for ws in (a, b):
            await ws.send_json({"t": "result", "winners": ["태고"], "losers": ["민수"]})
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
            await self.finish(a, b, ["태고"], ["민수"])
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

    async def test_only_quirk_titles_can_be_claimed_and_wrong_codes_count(self):
        a = await self.connect("aaaaaaaa1", "태고")
        for title in ("dev", "kda", "chess_s10", "q_wrong", "없는칭호"):  # 신청 목록에 없으면 무시
            await a.send_json({"t": "quirk", "title": title})
        await a.send_json({"t": "quirk", "title": "q_logo"})
        self.assertEqual((await self.until(a, "title_grant"))["title"], "q_logo")
        b = await self.connect("bbbbbbbb2", "민수")  # 5초에 8번 제한에 걸리지 않게 다른 사람으로
        for _ in range(5):
            await b.send_json({"t": "redeem", "code": "wrong-code"})
        self.assertEqual((await self.until(b, "title_grant"))["title"], "q_wrong")
        for ws in (a, b):
            await ws.close()

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
        self.assertEqual(set(server.TITLE_CODES.values()), server.TITLE_IDS - server.EARNED_ONLY_TITLES)  # 조건으로만 받는 칭호를 빼면 모두 코드가 있음
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
        await self.finish(a, b, ["태고", "가짜"])
        rank = await self.ranking_of(a)
        self.assertEqual(sorted(rank), ["민수", "태고"])
        self.assertEqual(rank["태고"]["chess"], {"wins": 1, "games": 1})
        for ws in (a, b):
            await ws.close()

    async def test_loser_goes_to_spectators_and_join_only_takes_the_seat(self):
        a, b, code = await self.two_players("chess")
        c = await self.connect("cccccccc3", "지수")
        await c.send_json({"t": "join", "room": code})  # 꽉 찬 방 → 관전
        room = (await self.until(c, "room"))["room"]
        self.assertEqual({m["name"]: m["role"] for m in room["members"]}["지수"], "spectator")
        await c.send_json({"t": "seat", "role": "player"})  # 자리가 없으면 못 앉음
        room = (await self.until(c, "room"))["room"]
        self.assertEqual({m["name"]: m["role"] for m in room["members"]}["지수"], "spectator")
        await self.start(a, b, "chess")

        room = await self._finish_seen_by(a, (a, b), "민수", "태고")  # 방장(태고)이 져서 관전으로 가도 방장은 그대로
        roles = {m["name"]: m["role"] for m in room["members"]}
        self.assertEqual((roles["태고"], roles["지수"], roles["민수"]), ("spectator", "spectator", "player"))  # 자동으로 앉지 않음
        self.assertEqual({m["name"]: m["champion"] for m in room["members"]}["민수"], True)
        await a.send_json({"t": "rooms"})
        self.assertEqual((await self.until(a, "rooms"))["rooms"][0]["king"], {"name": "민수", "streak": 1})

        await c.send_json({"t": "seat", "role": "player"})  # 빈자리 참가하기는 앉기만 하고 시작하지 않음
        room = await self._room_when(b, lambda r: {m["name"]: m["role"] for m in r["members"]}["지수"] == "player")
        self.assertEqual(room["status"], "done")
        await self.quiet(b)
        await a.send_json({"t": "seat", "role": "player"})  # 먼저 누른 사람이 앉으면 자리가 없음
        room = (await self.until(a, "room"))["room"]
        self.assertEqual({m["name"]: m["role"] for m in room["members"]}["태고"], "spectator")
        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess"}})  # 방장이 시작
        self.assertEqual(await self._start_seats(b), ["지수", "민수"])  # 도전자가 선공
        for ws in (a, b, c):
            await ws.close()

    async def test_loser_keeps_seat_when_nobody_is_waiting(self):
        a, b, _ = await self.two_players("chess")
        await self.start(a, b, "chess")
        room = await self.finish(a, b, ["태고"], ["민수"])
        self.assertEqual({m["name"]: m["role"] for m in room["members"]}["민수"], "player")
        for ws in (a, b):
            await ws.close()

    async def test_host_can_send_player_to_spectators_only_between_games(self):
        a, b, code = await self.two_players("chess")
        await b.send_json({"t": "to_spectator", "pid": self.pids["aaaaaaaa1"]})  # 방장만 할 수 있음
        await self.quiet(b)
        await self.start(a, b, "chess")
        await a.send_json({"t": "to_spectator", "pid": self.pids["bbbbbbbb2"]})  # 게임 중에는 안 됨
        await self.quiet(a)
        room = await self.finish(a, b, ["민수"], ["태고"])
        await a.send_json({"t": "to_spectator", "pid": self.pids["bbbbbbbb2"]})
        room = (await self.until(a, "room"))["room"]
        member = next(m for m in room["members"] if m["name"] == "민수")
        self.assertEqual((member["role"], member["streak"]), ("spectator", 0))
        for ws in (a, b):
            await ws.close()

    async def _finish_seen_by(self, viewer, seated, winner, loser):
        for ws in seated:
            await ws.send_json({"t": "result", "winners": [winner], "losers": [loser]})
        room = (await self.until(viewer, "room"))["room"]
        while room["status"] != "done":
            room = (await self.until(viewer, "room"))["room"]
        return room

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
        self.v2 = True  # 새 함수 · 표가 있는 DB인지
        self.reads_fail = False

        async def rpc_old(request):
            self.calls.append(("old", request.headers.get("apikey"), await request.json()))
            return web.Response(status=204)

        async def rpc_new(request):
            self.calls.append(("v2", request.headers.get("apikey"), await request.json()))
            return web.Response(status=204 if self.v2 else 404)

        async def old_table(request):
            self.calls.append(("read", request.headers.get("Authorization")))
            if self.reads_fail:
                return web.Response(status=500)
            return web.json_response([{"name": "옛사람", "game": "yacht", "wins": 3, "games": 5}])

        async def new_table(request):
            self.calls.append(("read", request.headers.get("Authorization")))
            if not self.v2:
                return web.Response(status=404)
            return web.json_response([{"player_id": "AAA", "name": "태고", "game": "yacht", "wins": 2, "games": 2},
                                      {"player_id": "AAA", "name": "태고", "game": "chess", "wins": 1, "games": 1},
                                      {"player_id": "BBB", "name": "태고", "game": "yacht", "wins": 0, "games": 2},
                                      {"player_id": "BBB", "name": "태고", "game": "bingo", "wins": 1, "games": 1}])

        app = web.Application()
        app.router.add_post("/rest/v1/rpc/kidk_add_result", rpc_old)
        app.router.add_post("/rest/v1/rpc/kidk_add_result_v2", rpc_new)
        app.router.add_get("/rest/v1/kidk_ranking", old_table)
        app.router.add_get("/rest/v1/kidk_player_ranking", new_table)
        self.fake = TestServer(app)
        await self.fake.start_server()
        self.store = ranking_store.SupabaseStore(str(self.fake.make_url("")), "service-key")

    async def asyncTearDown(self):
        await self.store.close()
        await self.fake.close()

    PLAYERS = [{"id": "AAA", "name": "태고"}, {"id": "BBB", "name": "민수"}]

    async def test_add_and_read(self):
        await self.store.add("yacht", self.PLAYERS, ["AAA"])
        self.assertEqual(self.calls[0], ("v2", "service-key", {"p_game": "yacht", "p_players": self.PLAYERS, "p_winners": ["AAA"]}))
        rows = await self.store.all()
        self.assertEqual(rows, [
            {"id": "AAA", "name": "태고", "legacy": False, "games": {"yacht": {"wins": 2, "games": 2}, "chess": {"wins": 1, "games": 1}}},
            {"id": "BBB", "name": "태고", "legacy": False, "games": {"yacht": {"wins": 0, "games": 2}}},  # 같은 이름도 따로, 모르는 게임은 버림
            {"id": "", "name": "옛사람", "legacy": True, "games": {"yacht": {"wins": 3, "games": 5}}},
        ])
        self.assertEqual(self.calls[1], ("read", "Bearer service-key"))
        self.assertTrue(self.store.ok)
        count = len(self.calls)
        await self.store.all()  # 10초 안에는 다시 부르지 않음
        self.assertEqual(len(self.calls), count)

    async def test_before_schema_update_keeps_working(self):
        self.v2 = False
        await self.store.add("yacht", self.PLAYERS, ["AAA"])
        self.assertEqual(self.calls[-1], ("old", "service-key", {"p_game": "yacht", "p_players": ["태고", "민수"], "p_winners": ["태고"]}))
        rows = await self.store.all()
        self.assertEqual([r["name"] for r in rows], ["옛사람"])  # 예전 표는 계속 보임
        self.assertTrue(self.store.ok)

    async def test_failed_read_is_not_shown_as_empty(self):
        self.reads_fail = True
        self.assertEqual(await self.store.all(), [])
        self.assertFalse(self.store.ok)

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
