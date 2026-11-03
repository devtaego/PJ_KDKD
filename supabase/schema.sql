-- KI득KI득 우리 반 랭킹 (Supabase → SQL Editor 에 붙여 넣고 Run)
-- 서버(Render)는 service_role 키로만 접근하고, 브라우저(anon 키)는 읽기도 쓰기도 못 하게 막아 둠.

create table if not exists public.kidk_ranking (
  name       text        not null check (char_length(name) between 1 and 12),
  game       text        not null check (game in ('chess', 'omok', 'yacht', 'yut')),
  wins       integer     not null default 0,
  games      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (name, game)
);

alter table public.kidk_ranking enable row level security;

-- 이미 예전 버전으로 표를 만들었다면: 윷놀이('yut')도 받도록 게임 목록 제한을 다시 걸어 줌 (여러 번 실행해도 괜찮음)
alter table public.kidk_ranking drop constraint if exists kidk_ranking_game_check;
alter table public.kidk_ranking add constraint kidk_ranking_game_check check (game in ('chess', 'omok', 'yacht', 'yut'));
-- 정책(policy)을 하나도 만들지 않음 → anon / authenticated 키로는 접근 불가, service_role 키만 가능

-- 한 판 결과를 한 번에 더함 (같은 판에 같은 이름이 두 번 오면 서버가 미리 하나로 합쳐서 보냄)
create or replace function public.kidk_add_result(p_game text, p_players text[], p_winners text[])
returns void
language sql
security definer
set search_path = public
as $$
  insert into kidk_ranking (name, game, wins, games)
  select n, p_game, case when n = any (p_winners) then 1 else 0 end, 1
  from unnest(p_players) as n
  on conflict (name, game) do update
    set wins = kidk_ranking.wins + excluded.wins,
        games = kidk_ranking.games + 1,
        updated_at = now();
$$;

revoke execute on function public.kidk_add_result(text, text[], text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------- 플레이어 번호 기준 랭킹
-- 이름이 아니라 번호로 저장 → 같은 이름이어도 섞이지 않고, 닉네임을 바꿔도 이어짐. 위의 kidk_ranking은 '이전 기록'으로 남겨 둠.
-- 여러 번 실행해도 괜찮음.

create table if not exists public.kidk_player_ranking (
  player_id  text        not null check (char_length(player_id) between 1 and 32),
  name       text        not null check (char_length(name) between 1 and 12),
  game       text        not null check (game in ('chess', 'omok', 'yacht', 'yut')),
  wins       integer     not null default 0,
  games      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, game)
);

alter table public.kidk_player_ranking enable row level security;
-- 정책(policy)을 만들지 않음 → anon / authenticated 키로는 접근 불가, service_role 키만 가능

-- p_players: [{"id": 번호, "name": 이름}], p_winners: 이긴 사람의 번호 목록
create or replace function public.kidk_add_result_v2(p_game text, p_players jsonb, p_winners text[])
returns void
language sql
security definer
set search_path = public
as $$
  insert into kidk_player_ranking (player_id, name, game, wins, games)
  select p->>'id', p->>'name', p_game, case when (p->>'id') = any (p_winners) then 1 else 0 end, 1
  from jsonb_array_elements(p_players) as p
  on conflict (player_id, game) do update
    set name = excluded.name,
        wins = kidk_player_ranking.wins + excluded.wins,
        games = kidk_player_ranking.games + 1,
        updated_at = now();
  -- 닉네임을 바꿨으면 다른 게임 기록의 이름도 함께 바꿈
  update kidk_player_ranking r
    set name = p->>'name'
  from jsonb_array_elements(p_players) as p
  where r.player_id = p->>'id' and r.name <> p->>'name';
$$;

revoke execute on function public.kidk_add_result_v2(text, jsonb, text[]) from public, anon, authenticated;
