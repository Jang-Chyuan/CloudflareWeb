begin;
create table if not exists public.device_commands (
  id uuid primary key default gen_random_uuid(),
  master_id integer not null check (master_id = 201),
  slave_id integer not null check (slave_id = 102),
  action text not null check (action in ('tracking', 'sleep')),
  requested_by uuid not null references auth.users(id),
  request_id uuid not null,
  radio_command_id bigint generated always as identity (start with 1 maxvalue 4294967295 no cycle) unique not null,
  status text not null default 'queued' check (status in
    ('queued','claimed','confirmed','rejected','unconfirmed','expired','superseded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 seconds'),
  claim_token uuid, lease_until timestamptz, claimed_at timestamptz,
  reported_mode smallint check (reported_mode in (0,1)),
  error_code text, completed_at timestamptz,
  unique (requested_by, request_id)
);
create index if not exists device_commands_poll_idx on public.device_commands(master_id, slave_id, status, created_at);
alter table public.device_commands enable row level security;
revoke all on public.device_commands from public, anon, authenticated;
grant select on public.device_commands to authenticated;
grant select, insert, update on public.device_commands to service_role;
drop policy if exists device_commands_read on public.device_commands;
create policy device_commands_read on public.device_commands for select to authenticated using (
  exists (select 1 from public.device_members m
    where m.user_id = (select auth.uid())
      and m.gateway_id = 'master_' || device_commands.master_id::text)
);

create or replace function public.create_device_command(
  p_master_id integer, p_slave_id integer, p_action text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  command public.device_commands%rowtype;
begin
  if caller is null then raise exception 'Login required' using errcode = '42501'; end if;
  if p_master_id is distinct from 201 or p_slave_id is distinct from 102
    or p_action is null or p_action not in ('tracking','sleep') or p_request_id is null then
    raise exception 'Invalid command' using errcode = '22023';
  end if;
  if not exists (select 1 from public.device_members m where m.user_id = caller
    and m.gateway_id = 'master_' || p_master_id::text) then
    raise exception 'Device access denied' using errcode = '42501';
  end if;
  insert into public.device_commands(master_id, slave_id, action, requested_by, request_id)
    values (p_master_id, p_slave_id, p_action, caller, p_request_id)
    on conflict (requested_by, request_id) do nothing returning * into command;
  if command.id is null then
    select * into command from public.device_commands where requested_by = caller and request_id = p_request_id;
    if command.action <> p_action or command.master_id <> p_master_id or command.slave_id <> p_slave_id then
      raise exception 'Request ID reused for a different command' using errcode = '22023';
    end if;
  end if;
  return to_jsonb(command);
end;
$$;
revoke all on function public.create_device_command(integer,integer,text,uuid) from public, anon;
grant execute on function public.create_device_command(integer,integer,text,uuid) to authenticated;
commit;
