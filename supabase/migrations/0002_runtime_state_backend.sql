-- Durable SOCIAL VEGAS runtime-state compatibility backend.
-- This keeps the existing in-memory game engine authoritative while moving persistence
-- from ephemeral data/state.json to the dedicated Vegas Supabase project.
-- The runtime secret hash is provisioned out-of-band and must never be committed.

create table if not exists private.runtime_state (
  state_key text primary key check (state_key = 'primary'),
  state jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table if not exists private.runtime_config (
  config_key text primary key,
  config_value text not null,
  updated_at timestamptz not null default now()
);

create or replace function private.vegas_runtime_authorized(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private, extensions
as $$
  select exists (
    select 1
    from private.runtime_config
    where config_key = 'server_secret_sha256'
      and config_value = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
  );
$$;

revoke all on function private.vegas_runtime_authorized(text) from public, anon, authenticated;

create or replace function public.vegas_runtime_load(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  payload jsonb;
begin
  if not private.vegas_runtime_authorized(p_secret) then
    raise exception 'unauthorized runtime access' using errcode = '28000';
  end if;

  select jsonb_build_object('state', state, 'version', version, 'updated_at', updated_at)
    into payload
  from private.runtime_state
  where state_key = 'primary';

  return coalesce(payload, jsonb_build_object('state', null, 'version', 0));
end;
$$;

create or replace function public.vegas_runtime_save(
  p_secret text,
  p_expected_version bigint,
  p_state jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  current_version bigint;
  next_version bigint;
begin
  if not private.vegas_runtime_authorized(p_secret) then
    raise exception 'unauthorized runtime access' using errcode = '28000';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'runtime state must be a JSON object' using errcode = '22023';
  end if;

  select version into current_version
  from private.runtime_state
  where state_key = 'primary'
  for update;

  if not found then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'runtime state version conflict' using errcode = '40001';
    end if;
    insert into private.runtime_state(state_key, state, version, updated_at)
    values ('primary', p_state, 1, now());
    return 1;
  end if;

  if current_version <> p_expected_version then
    raise exception 'runtime state version conflict' using errcode = '40001';
  end if;

  next_version := current_version + 1;
  update private.runtime_state
  set state = p_state, version = next_version, updated_at = now()
  where state_key = 'primary';

  return next_version;
end;
$$;

revoke all on function public.vegas_runtime_load(text) from public;
revoke all on function public.vegas_runtime_save(text, bigint, jsonb) from public;
grant execute on function public.vegas_runtime_load(text) to anon, authenticated, service_role;
grant execute on function public.vegas_runtime_save(text, bigint, jsonb) to anon, authenticated, service_role;
