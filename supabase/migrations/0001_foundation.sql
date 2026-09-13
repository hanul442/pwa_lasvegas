-- SOCIAL VEGAS production foundation schema.
-- Economy writes should be performed only by the trusted application server.
create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null unique,
  avatar_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bankroll_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  available_balance bigint not null default 100000000 check (available_balance >= 0),
  locked_balance bigint not null default 0 check (locked_balance >= 0),
  raw_game_pnl bigint not null default 0,
  qualified_game_pnl bigint not null default 0,
  total_wagered bigint not null default 0 check (total_wagered >= 0),
  progression_value bigint not null default 100000000 check (progression_value >= 0),
  peak_bankroll bigint not null default 100000000 check (peak_bankroll >= 0),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chip_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_type text not null,
  available_delta bigint not null default 0,
  locked_delta bigint not null default 0,
  available_before bigint not null check (available_before >= 0),
  available_after bigint not null check (available_after >= 0),
  locked_before bigint not null check (locked_before >= 0),
  locked_after bigint not null check (locked_after >= 0),
  raw_pnl_delta bigint not null default 0,
  qualified_pnl_delta bigint not null default 0,
  reference_type text,
  reference_id text,
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists chip_ledger_user_created_idx on public.chip_ledger(user_id, created_at desc);

create table if not exists public.recharge_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_auto_recharge_at timestamptz,
  daily_auto_count integer not null default 0 check (daily_auto_count between 0 and 3),
  daily_count_date date not null default current_date,
  total_auto_recharged bigint not null default 0 check (total_auto_recharged >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.recharge_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_amount bigint not null check (requested_amount in (10000000,30000000,50000000)),
  reason_code text not null default 'CONTINUE_PLAYING',
  reason_text text,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','PARTIALLY_APPROVED','DECLINED','CANCELLED')),
  approved_amount bigint,
  reviewed_by uuid references auth.users(id),
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create unique index if not exists recharge_one_pending_per_user_idx on public.recharge_requests(user_id) where status='PENDING';

create table if not exists public.floors (
  slug text primary key,
  name text not null,
  unlock_progression bigint not null check (unlock_progression >= 0),
  min_bet bigint not null check (min_bet > 0),
  max_bet bigint not null check (max_bet >= min_bet),
  sort_order integer not null unique,
  is_active boolean not null default true
);
insert into public.floors(slug,name,unlock_progression,min_bet,max_bet,sort_order) values
  ('downtown','Downtown',0,100000,1000000,1),
  ('strip','The Strip',100000000,1000000,10000000,2),
  ('high-limit','High Limit',1000000000,10000000,100000000,3),
  ('salon-prive','Salon Privé',5000000000,50000000,500000000,4),
  ('penthouse','Penthouse',20000000000,200000000,2000000000,5),
  ('vault','The Vault',100000000000,1000000000,10000000000,6)
on conflict (slug) do update set name=excluded.name, unlock_progression=excluded.unlock_progression, min_bet=excluded.min_bet, max_bet=excluded.max_bet, sort_order=excluded.sort_order;

create table if not exists public.floor_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  floor_slug text not null references public.floors(slug),
  unlock_progression_value bigint not null,
  unlocked_at timestamptz not null default now(),
  primary key(user_id,floor_slug)
);

create table if not exists public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  game_type text not null,
  floor_slug text references public.floors(slug),
  state text not null,
  result jsonb,
  server_seed_hash text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists game_rounds_user_created_idx on public.game_rounds(user_id,created_at desc);

create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bet_type text not null,
  amount bigint not null check (amount > 0),
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.game_rounds(id),
  user_id uuid not null references auth.users(id),
  bet_id uuid unique references public.bets(id),
  stake bigint not null check (stake > 0),
  gross_return bigint not null check (gross_return >= 0),
  net_pnl bigint not null,
  settlement_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id),
  target_user_id uuid references auth.users(id),
  action_type text not null,
  reference_type text,
  reference_id text,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);

-- RLS: public schema is API-exposed by default. Direct economy mutations are intentionally denied.
alter table public.profiles enable row level security;
alter table public.bankroll_accounts enable row level security;
alter table public.chip_ledger enable row level security;
alter table public.recharge_state enable row level security;
alter table public.recharge_requests enable row level security;
alter table public.floors enable row level security;
alter table public.floor_unlocks enable row level security;
alter table public.game_rounds enable row level security;
alter table public.bets enable row level security;
alter table public.settlements enable row level security;
alter table public.admin_actions enable row level security;

create policy "authenticated profiles readable" on public.profiles for select to authenticated using (true);
create policy "owner profile update" on public.profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "owner bankroll read" on public.bankroll_accounts for select to authenticated using ((select auth.uid())=user_id);
create policy "owner ledger read" on public.chip_ledger for select to authenticated using ((select auth.uid())=user_id);
create policy "owner recharge state read" on public.recharge_state for select to authenticated using ((select auth.uid())=user_id);
create policy "owner recharge request read" on public.recharge_requests for select to authenticated using ((select auth.uid())=user_id);
create policy "owner recharge request create" on public.recharge_requests for insert to authenticated with check ((select auth.uid())=user_id);
create policy "floors readable" on public.floors for select to authenticated using (true);
create policy "owner unlocks read" on public.floor_unlocks for select to authenticated using ((select auth.uid())=user_id);
create policy "owner round history read" on public.game_rounds for select to authenticated using ((select auth.uid())=user_id);
create policy "owner bets read" on public.bets for select to authenticated using ((select auth.uid())=user_id);
create policy "owner settlements read" on public.settlements for select to authenticated using ((select auth.uid())=user_id);

-- Seed account/profile atomically when Supabase Auth creates a user.
create or replace function private.handle_social_vegas_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  display_name text;
begin
  display_name := coalesce(nullif(new.raw_user_meta_data->>'nickname',''), 'PLAYER_' || left(new.id::text,8));
  insert into public.profiles(user_id,nickname) values(new.id,display_name);
  insert into public.bankroll_accounts(user_id) values(new.id);
  insert into public.recharge_state(user_id) values(new.id);
  insert into public.floor_unlocks(user_id,floor_slug,unlock_progression_value) values
    (new.id,'downtown',100000000),(new.id,'strip',100000000);
  insert into public.chip_ledger(user_id,transaction_type,available_delta,available_before,available_after,locked_before,locked_after,reference_type,metadata)
  values(new.id,'INITIAL_GRANT',100000000,0,100000000,0,0,'SYSTEM','{"initial":true}'::jsonb);
  return new;
end;
$$;
revoke execute on function private.handle_social_vegas_new_user() from public, anon, authenticated;

drop trigger if exists on_social_vegas_user_created on auth.users;
create trigger on_social_vegas_user_created after insert on auth.users for each row execute function private.handle_social_vegas_new_user();
