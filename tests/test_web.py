"""KI득KI득 웹 서버 자동 테스트 (방 만들기 · 참가 · 수 전달 · 재접속 · 랭킹)

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
    from aiohttp.test_utils import TestClient, TestServer
    os.environ["KIDK_RANKING_FILE"] = os.path.join(tempfile.mkdtemp(), "ranking.json")
    import server
except ImportError:  # 데스크톱판만 쓰는 PC
    server = None


@unittest.skipIf(server is None, "aiohttp가 설치되어 있지 않음")
class WebServerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
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

    async def test_profile_is_cleaned(self):
        p = server.clean_profile({"name": "  아주아주아주아주긴닉네임입니다  ", "avatar": "<script>", "intro": "x" * 99})
        self.assertEqual((len(p["name"]), p["avatar"], len(p["intro"])), (12, "cat", 30))
        self.assertIsNone(server.clean_profile({"name": "   "}))


if __name__ == "__main__":
    unittest.main()
