begin;
alter table public.device_commands drop constraint if exists device_commands_slave_id_check;
alter table public.device_commands add constraint device_commands_slave_id_check check (slave_id in (102,108));

create or replace function public.create_device_command(p_master_id integer,p_slave_id integer,p_action text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); c public.device_commands%rowtype;
begin
  if caller is null then raise exception 'Login required' using errcode='42501'; end if;
  if p_master_id is distinct from 201 or p_slave_id is null or p_slave_id not in (102,108)
    or p_action is null or p_action not in ('tracking','sleep') or p_request_id is null then
    raise exception 'Invalid command' using errcode='22023'; end if;
  if not exists(select 1 from public.device_members where user_id=caller and gateway_id='master_201') then
    raise exception 'Device access denied' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(201,p_slave_id);
  select * into c from public.device_commands where requested_by=caller and request_id=p_request_id;
  if found then
    if c.action<>p_action or c.master_id<>p_master_id or c.slave_id<>p_slave_id then
      raise exception 'Request ID reused for a different command' using errcode='22023'; end if;
    return to_jsonb(c);
  end if;
  if p_action='tracking' then
    select * into c from public.device_commands where master_id=201 and slave_id=p_slave_id
      order by created_at desc,radio_command_id desc limit 1;
    if found then
      if c.action='tracking' and c.status in ('queued','claimed') and c.expires_at>clock_timestamp() then
        return to_jsonb(c); end if;
    end if;
  end if;
  insert into public.device_commands(master_id,slave_id,action,requested_by,request_id,created_at,expires_at)
    values(201,p_slave_id,p_action,caller,p_request_id,clock_timestamp(),clock_timestamp()+interval '60 seconds') returning * into c;
  return to_jsonb(c);
end; $$;

create or replace function public.claim_master_command(p_master_id integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.device_commands%rowtype;
begin
  if p_master_id is distinct from 201 then raise exception 'Invalid master'; end if;
  -- Always take both locks in the same order; one in-flight command per Master.
  perform pg_catalog.pg_advisory_xact_lock(201,102);
  perform pg_catalog.pg_advisory_xact_lock(201,108);
  update public.device_commands set status='expired',completed_at=clock_timestamp()
    where master_id=201 and slave_id in(102,108) and status='queued' and expires_at<=clock_timestamp();
  update public.device_commands set status='unconfirmed',error_code='lease_expired',completed_at=clock_timestamp()
    where master_id=201 and slave_id in(102,108) and status='claimed' and lease_until<=clock_timestamp();
  if exists(select 1 from public.device_commands where master_id=201 and slave_id in(102,108) and status='claimed') then
    return jsonb_build_object('command',null); end if;
  -- Latest intent per slave; oldest waiting device first. Never supersede another slave.
  select * into c from public.device_commands q where master_id=201 and slave_id in(102,108) and status='queued'
    and not exists(select 1 from public.device_commands newer where newer.master_id=q.master_id
      and newer.slave_id=q.slave_id and newer.status='queued'
      and (newer.created_at,newer.radio_command_id)>(q.created_at,q.radio_command_id))
    order by created_at,radio_command_id limit 1 for update;
  if not found then return jsonb_build_object('command',null); end if;
  update public.device_commands set status='superseded',completed_at=clock_timestamp()
    where master_id=201 and slave_id=c.slave_id and status='queued' and id<>c.id;
  if c.radio_command_id<1 or c.radio_command_id>2147483647 then
    update public.device_commands set status='rejected',error_code='radio_id_range',completed_at=clock_timestamp() where id=c.id;
    return jsonb_build_object('command',null); end if;
  update public.device_commands set status='claimed',claim_token=gen_random_uuid(),claimed_at=clock_timestamp(),
    lease_until=clock_timestamp()+interval '180 seconds' where id=c.id returning * into c;
  return jsonb_build_object('command',jsonb_build_object('id',c.id,'master_id',c.master_id,'slave_id',c.slave_id,
    'action',c.action,'radio_command_id',c.radio_command_id,'claim_token',c.claim_token,
    'expires_at_epoch',floor(extract(epoch from c.expires_at))::bigint));
end; $$;

create or replace function public.report_master_command(p_master_id integer,p_id uuid,p_claim_token uuid,
  p_radio_command_id bigint,p_outcome text,p_reported_mode integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.device_commands%rowtype;
begin
  if p_master_id is distinct from 201 or p_outcome is null or p_outcome not in('confirmed','rejected','unconfirmed','expired')
    or (p_reported_mode is not null and p_reported_mode not in(0,1)) then raise exception 'Invalid report'; end if;
  perform pg_catalog.pg_advisory_xact_lock(201,102);
  perform pg_catalog.pg_advisory_xact_lock(201,108);
  select * into c from public.device_commands where id=p_id and master_id=201 and slave_id in(102,108) for update;
  if not found or c.claim_token is distinct from p_claim_token or p_claim_token is null
    or c.radio_command_id is distinct from p_radio_command_id then return jsonb_build_object('conflict',true); end if;
  if p_outcome='confirmed' and (p_reported_mode is null or p_reported_mode<>case when c.action='tracking' then 1 else 0 end) then
    raise exception 'Mode mismatch'; end if;
  if c.status<>'claimed' then
    if c.status=p_outcome and c.reported_mode is not distinct from p_reported_mode then return jsonb_build_object('ok',true); end if;
    return jsonb_build_object('conflict',true);
  end if;
  update public.device_commands set status=p_outcome,reported_mode=p_reported_mode,completed_at=clock_timestamp(),lease_until=null,
    error_code=case when p_outcome='unconfirmed' then 'no_ack_or_master_restart'
      when p_outcome='rejected' then 'slave_rejected_or_local_queue' else null end where id=c.id;
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.create_device_command(integer,integer,text,uuid) from public,anon;
grant execute on function public.create_device_command(integer,integer,text,uuid) to authenticated;
revoke all on function public.claim_master_command(integer) from public,anon,authenticated;
revoke all on function public.report_master_command(integer,uuid,uuid,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.claim_master_command(integer) to service_role;
grant execute on function public.report_master_command(integer,uuid,uuid,bigint,text,integer) to service_role;
commit;
