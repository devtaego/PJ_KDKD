"""KI득KI득 웹 서버 자동 테스트 (방 만들기 · 참가 · 수 전달 · 재접속 · 랭킹 · 비공개 방 · 도배 막기)

실행: python -m unittest discover -s tests -v   (aiohttp가 없으면 건너뜀)
"""
import asyncio
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "web"))

try:
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
    os.environ["KIDK_RANKING_FILE"] = os.path.join(tempfile.mkdtemp(), "ranking.json")
    os.environ.pop("SUPABASE_URL", None)
    import ranking_store
    import server
except ImportError:  # 데스크톱판만 쓰는 PC
    server = None


@unittest.skipIf(server is None, "aiohttp가 설치되어 있지 않음")
class WebServerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        os.environ["KIDK_RANKING_FILE"] = os.path.join(tempfile.mkdtemp(), "ranking.json")  # 테스트마다 빈 랭킹
        server.hub.__init__()
        self.client = TestClient(TestServer(server.make_app()))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def connect(self, cid, name):
        ws = await self.client.ws_connect(f"/ws?cid={cid}")
        welcome = await ws.receive_json()
        self.assertEqual(welcome["t"], "welcome")
        await ws.send_json({"t": "profile", "profile": {"name": name, "avatar": "fox", "intro": "ENFP"}})
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
        seats = [{"cid": "aaaaaaaa1", "name": "태고"}, {"cid": "bbbbbbbb2", "name": "민수"}]
        await a.send_json({"t": "act", "a": {"type": "start", "game": "omok", "seats": seats}})
        start = await self.until(b, "act")
        self.assertEqual((start["a"]["type"], start["from"]), ("start", "aaaaaaaa1"))

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
        b = await self.client.ws_connect("/ws?cid=bbbbbbbb2")
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
        await a.send_json({"t": "act", "a": {"type": "start", "game": "chess", "seats": []}})
        await self.until(b, "act")
        await self.until(a, "act")  # 방장도 자기 start를 돌려받음
        await b.send_json({"t": "leave"})
        leave = await self.until(a, "act")
        self.assertEqual((leave["a"]["type"], leave["from"]), ("leave", "bbbbbbbb2"))
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
        await a.send_json({"t": "act", "a": {"type": "start", "game": game, "seats": []}})
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

    async def test_host_can_act_only_for_offline_player(self):
        a, b, _ = await self.two_players("yacht")
        await self.start(a, b, "yacht")
        await a.send_json({"t": "act", "a": {"type": "hold", "i": 0}, "as": "bbbbbbbb2"})  # b는 접속 중 → 무시
        self.assertEqual(await self.quiet(a), "pong")
        await b.close()
        await asyncio.sleep(0.2)
        await a.send_json({"t": "act", "a": {"type": "hold", "i": 0}, "as": "bbbbbbbb2"})
        entry = await self.until(a, "act")
        self.assertEqual(entry["from"], "bbbbbbbb2")
        await a.send_json({"t": "act", "a": {"type": "resign"}, "as": "bbbbbbbb2"})  # 대신 항복은 못 함
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
        self.assertEqual(room["queue"], ["cccccccc3"])

        for winner, loser, expect_streak in (("민수", "태고", 1), ("민수", "지수", 2)):  # 방장(태고)이 져서 줄로 가도 시작 가능
            await a.send_json({"t": "act", "a": {"type": "start", "game": "chess", "seats": []}})
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
