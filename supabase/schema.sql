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
