"""우리 반 랭킹 저장소.

- SUPABASE_URL, SUPABASE_SERVICE_KEY 환경 변수가 있으면 Supabase(Postgres)에 저장 → 다시 배포해도 남음
- 없으면 서버 폴더의 ranking.json 파일에 저장 (내 PC에서 돌릴 때, Render 무료 플랜에서는 재시작하면 지워짐)

기록은 이름이 아니라 플레이어 번호로 저장함 (같은 이름이어도 섞이지 않고, 닉네임을 바꿔도 이어짐).
이름으로만 저장돼 있던 예전 기록은 주인을 가릴 수 없어서 '이전 기록'으로 따로 보여 줌.

add(game, players, winners): players = [{"id", "name"}], winners = 이긴 사람의 id 목록
all(): [{"id", "name", "legacy", "games": {game: {"wins", "games"}}}]

Supabase 쪽 표와 함수는 supabase/schema.sql 에 있음.
"""
import json
import os
import time

import aiohttp

GAMES = ("chess", "omok", "yacht", "yut")


def merge_rows(rows):
    """Supabase 표의 줄들을 사람별로 묶음. player_id가 없는 줄은 예전(이름 기준) 기록."""
    out = {}
    for r in rows:
        if r.get("game") not in GAMES or not r.get("name"):
            continue
        pid = r.get("player_id") or ""
        key = pid or f"legacy:{r['name']}"
        row = out.setdefault(key, {"id": pid, "name": r["name"], "legacy": not pid, "games": {}})
        row["games"][r["game"]] = {"wins": int(r.get("wins") or 0), "games": int(r.get("games") or 0)}
    return list(out.values())


class FileStore:
    kind = "file"
    ok = True

    def __init__(self, path):
        self.path = path
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        if data.get("v") == 2:
            self.players, self.legacy = data.get("players", {}), data.get("legacy", {})
        else:  # 예전 형식: {이름: {게임: 기록}}
            self.players, self.legacy = {}, data

    async def add(self, game, players, winners):
        for p in players:
            row = self.players.setdefault(p["id"], {"name": p["name"], "games": {}})
            row["name"] = p["name"]
            rec = row["games"].setdefault(game, {"wins": 0, "games": 0})
            rec["games"] += 1
            if p["id"] in winners:
                rec["wins"] += 1
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump({"v": 2, "players": self.players, "legacy": self.legacy}, f, ensure_ascii=False)
        except OSError:
            pass

    async def all(self):
        rows = [{"id": pid, "name": r["name"], "legacy": False, "games": r["games"]} for pid, r in self.players.items()]
        return rows + [{"id": "", "name": name, "legacy": True, "games": games} for name, games in self.legacy.items()]

    async def close(self):
        pass


class SupabaseStore:
    """Supabase REST(PostgREST)로 읽고 씀. 서비스 키는 서버에만 두고 브라우저에는 절대 보내지 않음."""
    kind = "supabase"
    CACHE_S = 10  # 랭킹 화면을 여러 명이 열어도 DB를 매번 부르지 않도록

    def __init__(self, url, key):
        self.url = url.rstrip("/")
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        self.session = None
        self.cache = None
        self.cache_at = 0.0
        self.ok = True  # 마지막으로 읽었을 때 DB에 닿았는지 (비어 있는 것과 실패를 구분)

    def _session(self):
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(headers=self.headers, timeout=aiohttp.ClientTimeout(total=8))
        return self.session

    async def _rpc(self, name, body):
        async with self._session().post(f"{self.url}/rest/v1/rpc/{name}", json=body) as resp:
            if resp.status >= 300 and resp.status != 404:
                print("supabase", name, "실패:", resp.status, (await resp.text())[:200])
            return resp.status

    async def add(self, game, players, winners):
        try:
            status = await self._rpc("kidk_add_result_v2", {"p_game": game, "p_players": players, "p_winners": winners})
            if status == 404:  # 아직 schema.sql을 다시 실행하기 전: 기록을 잃지 않게 예전 표에 저장
                print("supabase: kidk_add_result_v2가 없어요. supabase/schema.sql을 다시 실행해 주세요.")
                names = {p["id"]: p["name"] for p in players}
                await self._rpc("kidk_add_result", {"p_game": game, "p_players": [p["name"] for p in players],
                                                    "p_winners": [names[w] for w in winners if w in names]})
        except (aiohttp.ClientError, TimeoutError) as e:
            print("supabase 연결 실패:", e)
            return
        self.cache = None

    async def _rows(self, table, select):
        """표 하나를 읽음. 아직 없는 표(404)는 빈 목록, 그 밖의 실패는 None."""
        async with self._session().get(f"{self.url}/rest/v1/{table}", params={"select": select, "limit": "2000"}) as resp:
            if resp.status == 404:
                return []
            if resp.status >= 300:
                print("supabase 랭킹 읽기 실패:", table, resp.status, (await resp.text())[:200])
                return None
            rows = await resp.json()
            return rows if isinstance(rows, list) else []

    async def all(self):
        if self.cache is not None and time.time() - self.cache_at < self.CACHE_S:
            return self.cache
        try:
            players = await self._rows("kidk_player_ranking", "player_id,name,game,wins,games")
            legacy = await self._rows("kidk_ranking", "name,game,wins,games")
        except (aiohttp.ClientError, TimeoutError, ValueError) as e:
            print("supabase 연결 실패:", e)
            players = legacy = None
        self.ok = players is not None and legacy is not None
        if not self.ok:
            return self.cache or []
        self.cache = merge_rows(players + legacy)
        self.cache_at = time.time()
        return self.cache

    async def close(self):
        if self.session is not None:
            await self.session.close()


def make_store(default_path):
    url, key = os.environ.get("SUPABASE_URL", "").strip(), os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if url and key:
        return SupabaseStore(url, key)
    return FileStore(os.environ.get("KIDK_RANKING_FILE", default_path))
