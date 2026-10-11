begin;
create table if not exists public.slave_names (
  slave_id integer primary key check (slave_id between 1 and 255),
  master_id integer not null check (master_id between 1 and 65535),
  name text not null check (length(name) <= 20),
  updated_at timestamptz not null default now()
);
alter table public.slave_names enable row level security;
revoke all on public.slave_names from anon, authenticated;
grant select, insert, update on public.slave_names to authenticated;
create policy slave_names_read on public.slave_names for select to authenticated using (
  exists (select 1 from public.device_members m where m.user_id = (select auth.uid())
    and m.gateway_id = 'master_' || slave_names.master_id::text)
);
create policy slave_names_insert on public.slave_names for insert to authenticated with check (
  exists (select 1 from public.device_members m where m.user_id = (select auth.uid())
    and m.gateway_id = 'master_' || slave_names.master_id::text)
);
create policy slave_names_update on public.slave_names for update to authenticated using (
  exists (select 1 from public.device_members m where m.user_id = (select auth.uid())
    and m.gateway_id = 'master_' || slave_names.master_id::text)
) with check (
  exists (select 1 from public.device_members m where m.user_id = (select auth.uid())
    and m.gateway_id = 'master_' || slave_names.master_id::text)
);
commit;
