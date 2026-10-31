"""우리 반 랭킹 저장소.

- SUPABASE_URL, SUPABASE_SERVICE_KEY 환경 변수가 있으면 Supabase(Postgres)에 저장 → 다시 배포해도 남음
- 없으면 서버 폴더의 ranking.json 파일에 저장 (내 PC에서 돌릴 때, Render 무료 플랜에서는 재시작하면 지워짐)

Supabase 쪽 표와 함수는 supabase/schema.sql 에 있음.
"""
import json
import os
import time

import aiohttp

GAMES = ("chess", "omok", "yacht")


def merge_rows(rows):
    """[{name, game, wins, games}] -> {name: {game: {wins, games}}}"""
    out = {}
    for r in rows:
        if r.get("game") in GAMES and r.get("name"):
            out.setdefault(r["name"], {})[r["game"]] = {"wins": int(r.get("wins") or 0),
                                                         "games": int(r.get("games") or 0)}
    return out


class FileStore:
    kind = "file"

    def __init__(self, path):
        self.path = path
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            self.data = data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            self.data = {}

    async def add(self, game, players, winners):
        for name in players:
            rec = self.data.setdefault(name, {}).setdefault(game, {"wins": 0, "games": 0})
            rec["games"] += 1
            if name in winners:
                rec["wins"] += 1
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False)
        except OSError:
            pass

    async def all(self):
        return self.data

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

    def _session(self):
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(headers=self.headers, timeout=aiohttp.ClientTimeout(total=8))
        return self.session

    async def add(self, game, players, winners):
        body = {"p_game": game, "p_players": players, "p_winners": winners}
        try:
            async with self._session().post(f"{self.url}/rest/v1/rpc/kidk_add_result", json=body) as resp:
                if resp.status >= 300:
                    print("supabase add_result 실패:", resp.status, (await resp.text())[:200])
                    return
        except (aiohttp.ClientError, TimeoutError) as e:
            print("supabase 연결 실패:", e)
            return
        self.cache = None

    async def all(self):
        if self.cache is not None and time.time() - self.cache_at < self.CACHE_S:
            return self.cache
        try:
            async with self._session().get(f"{self.url}/rest/v1/kidk_ranking",
                                           params={"select": "name,game,wins,games", "limit": "2000"}) as resp:
                if resp.status >= 300:
                    print("supabase 랭킹 읽기 실패:", resp.status, (await resp.text())[:200])
                    return self.cache or {}
                rows = await resp.json()
        except (aiohttp.ClientError, TimeoutError, ValueError) as e:
            print("supabase 연결 실패:", e)
            return self.cache or {}
        self.cache = merge_rows(rows if isinstance(rows, list) else [])
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
