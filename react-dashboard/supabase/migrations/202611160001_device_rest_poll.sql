-- Direct device polling through PostgREST. Existing Edge callers remain valid.
begin;
create schema if not exists device_private;
revoke all on schema device_private from public, anon, authenticated;
create table device_private.command_credentials (
  master_id integer primary key check (master_id in (5,201)),
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default true
);
revoke all on device_private.command_credentials from public, anon, authenticated;
alter table device_private.command_credentials enable row level security;

create function public.poll_device_command_rest()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  supplied text;
  master integer;
begin
  supplied := (current_setting('request.headers', true)::jsonb)->>'x-device-token';
  if supplied is null or length(supplied) < 32 or length(supplied) > 256 then
    raise sqlstate 'PT401' using message = 'Invalid device token';
  end if;
  select master_id into master from device_private.command_credentials
    where enabled and token_sha256 = encode(sha256(convert_to(supplied, 'UTF8')), 'hex');
  if master is null then
    raise sqlstate 'PT401' using message = 'Invalid device token';
  end if;
  -- Master identity comes only from the credential, never from request arguments.
  -- Preserve the existing atomic claim, lease, expiry and superseding logic.
  return public.claim_master_command(master);
end;
$$;
revoke all on function public.poll_device_command_rest() from public, anon, authenticated;
grant execute on function public.poll_device_command_rest() to anon, authenticated;
commit;
