begin;
select set_config('request.jwt.claim.sub', (select user_id::text from public.device_members where gateway_id='master_201' limit 1), true);
set local role authenticated;
do $$
declare
  request uuid := gen_random_uuid();
  first_command jsonb;
  replay jsonb;
  sleeping jsonb;
begin
  first_command := public.create_device_command(201,102,'tracking',request);
  replay := public.create_device_command(201,102,'tracking',request);
  sleeping := public.create_device_command(201,102,'sleep',gen_random_uuid());
  if first_command->>'id' is distinct from replay->>'id' then raise exception 'Retry dedup failed'; end if;
  if first_command->>'status' <> 'queued' or sleeping->>'action' <> 'sleep'
    or (first_command->>'radio_command_id')::bigint < 1 then raise exception 'Command payload invalid'; end if;
  if not exists (select 1 from public.device_commands where id=(first_command->>'id')::uuid) then
    raise exception 'Authorized read failed'; end if;
  begin
    perform public.create_device_command(201,102,'sleep',request);
    raise exception 'Reused request allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_device_command(201,104,'tracking',gen_random_uuid());
    raise exception 'Wrong target allowed';
  exception when invalid_parameter_value then null; end;
  begin
    update public.device_commands set status='confirmed' where id=(first_command->>'id')::uuid;
    raise exception 'Browser status update allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$
begin
  begin
    perform public.create_device_command(201,102,'tracking',gen_random_uuid());
    raise exception 'Unauthorized command allowed';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.device_commands) then raise exception 'Unauthorized read allowed'; end if;
end;
$$;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.create_device_command(201,102,'tracking',gen_random_uuid());
    raise exception 'Missing login allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
rollback;
select 'PASS: tracking/sleep, retry dedup, payload mismatch, target validation, RLS, update denial, unauthorized and missing-login denial; all test rows rolled back' as verification;
