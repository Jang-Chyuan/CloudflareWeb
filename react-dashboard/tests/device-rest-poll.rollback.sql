-- Run as postgres after the migration. All fixtures and the stub roll back.
begin;
create or replace function public.claim_master_command(p_master_id integer)
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('test_master', p_master_id);
$$;
delete from device_private.command_credentials;
insert into device_private.command_credentials(master_id,token_sha256)
values (5,encode(sha256(convert_to(repeat('a',32),'UTF8')),'hex')),
       (201,encode(sha256(convert_to(repeat('b',32),'UTF8')),'hex'));
set local role anon;
do $$
declare result jsonb;
begin
  if has_schema_privilege(current_user,'device_private','USAGE') then
    raise exception 'Credential schema exposed';
  end if;
  if has_function_privilege(current_user,'public.claim_master_command(integer)','EXECUTE') then
    raise exception 'Underlying privileged RPC exposed';
  end if;
  perform set_config('request.headers','{}',true);
  begin
    perform public.poll_device_command_rest();
    raise exception 'Missing token accepted';
  exception when sqlstate 'PT401' then null; end;
  perform set_config('request.headers',jsonb_build_object('x-device-token',repeat('c',32))::text,true);
  begin
    perform public.poll_device_command_rest();
    raise exception 'Wrong token accepted';
  exception when sqlstate 'PT401' then null; end;
  perform set_config('request.headers',jsonb_build_object('x-device-token',repeat('a',32))::text,true);
  result := public.poll_device_command_rest();
  if result->>'test_master' <> '5' then raise exception 'Master 5 isolation failed'; end if;
  perform set_config('request.headers',jsonb_build_object('x-device-token',repeat('b',32))::text,true);
  result := public.poll_device_command_rest();
  if result->>'test_master' <> '201' then raise exception 'Master 201 isolation failed'; end if;
end $$;
reset role;
update device_private.command_credentials set enabled=false where master_id=201;
set local role anon;
do $$ begin
  begin
    perform public.poll_device_command_rest();
    raise exception 'Disabled token accepted';
  exception when sqlstate 'PT401' then null; end;
end $$;
rollback;
