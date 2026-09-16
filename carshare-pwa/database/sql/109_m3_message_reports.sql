-- Message evidence feeds the existing M1 safety queue. Requires 104, 106, 107.
-- Deploy with m3-message-reports. No direct client access to evidence/storage.
begin;
create table public.message_report_evidence (
  id uuid primary key,
  message_id uuid not null,
  snapshot jsonb not null,
  version text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  decision text,
  purged_at timestamptz,
  unique(message_id, version)
);
create table public.message_report_attempts (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  snapshot jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index message_report_attempts_actor_time on public.message_report_attempts(reporter_id, created_at);
alter table public.message_report_evidence enable row level security;
alter table public.message_report_attempts enable row level security;
revoke all on public.message_report_evidence, public.message_report_attempts from public, anon, authenticated;
grant all on public.message_report_evidence, public.message_report_attempts to service_role;
alter table public.messages add column moderated_at timestamptz;
alter table public.safety_reports add column message_evidence_id uuid references public.message_report_evidence(id);
drop index public.safety_reports_one_open_per_pair_idx;
create unique index safety_reports_one_open_per_pair_idx on public.safety_reports(reporter_id, reported_user_id)
  where status = 'open' and message_evidence_id is null;
create unique index safety_reports_message_reporter_idx on public.safety_reports(reporter_id, message_evidence_id)
  where message_evidence_id is not null;

insert into storage.buckets(id, name, public, file_size_limit)
values ('message-report-evidence', 'message-report-evidence', false, 52428800);

create function private.message_report_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('messageId', m.id, 'senderId', m.sender_id,
    'conversationId', m.conversation_id, 'rideId', c.ride_id, 'text', m.text_content,
    'createdAt', m.created_at, 'editedAt', m.edited_at,
    'attachments', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', a.kind, 'path', a.storage_path, 'name', a.file_name, 'mime', a.mime_type,
      'size', a.file_size) order by a.sort_order, a.id)
      from public.message_attachments a where a.message_id = m.id
        and a.kind in ('image','video','audio')), '[]'::jsonb))
  from public.messages m join public.conversations c on c.id = m.conversation_id
  where m.id = p_id and m.kind = 'user' and m.deleted_at is null;
$$;
revoke all on function private.message_report_snapshot(uuid) from public, anon, authenticated;

create function public.prepare_message_report(p_message_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb; v_id uuid; v_existing uuid; v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Sign in to report a message'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text, 109));
  if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Enter a reason of 1–500 characters'; end if;
  if not private.message_is_visible(p_message_id, v_actor) then raise exception 'Message unavailable'; end if;
  v_snapshot := private.message_report_snapshot(p_message_id);
  if v_snapshot is null or v_snapshot->>'senderId' = v_actor::text
    or (coalesce(v_snapshot->>'text','') = '' and jsonb_array_length(v_snapshot->'attachments') = 0)
    then raise exception 'This message cannot be reported'; end if;
  select id into v_existing from public.message_report_evidence
    where message_id = p_message_id and version = md5(v_snapshot::text);
  if exists(select 1 from public.message_report_evidence where id=v_existing and resolved_at is not null)
    then raise exception 'This message has already been reviewed'; end if;
  if exists(select 1 from public.safety_reports where reporter_id=v_actor and message_evidence_id=v_existing)
    then return jsonb_build_object('alreadyReported',true); end if;
  if (select count(*) from public.message_report_attempts where reporter_id=v_actor and created_at > now()-interval '1 day') >= 20
    or (select count(*) from public.message_report_attempts where reporter_id=v_actor and created_at > now()-interval '1 minute') >= 3
    then raise exception 'Too many reports. Please try again later'; end if;
  insert into public.message_report_attempts(reporter_id,snapshot,reason)
    values(v_actor,v_snapshot,trim(p_reason)) returning id into v_id;
  return jsonb_build_object('attemptId',v_id,'snapshot',v_snapshot,'existingEvidenceId',v_existing);
end; $$;
revoke all on function public.prepare_message_report(uuid,text) from public, anon;
grant execute on function public.prepare_message_report(uuid,text) to authenticated;

-- Trusted Edge Function calls only after copying every attachment. Recheck the
-- source under lock: if editing/deletion won the race, do not claim success.
create function public.finish_message_report(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_a public.message_report_attempts%rowtype; v_e public.message_report_evidence%rowtype;
  v_id uuid; v_i integer; v_count integer; v_message uuid; v_snapshot jsonb;
begin
  select * into strict v_a from public.message_report_attempts where id=p_attempt_id;
  if v_a.created_at < now()-interval '10 minutes' then raise exception 'Report expired. Please retry'; end if;
  v_message := (v_a.snapshot->>'messageId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(v_message::text,110));
  perform 1 from public.messages where id=v_message for update;
  v_snapshot := private.message_report_snapshot(v_message);
  if v_snapshot is distinct from v_a.snapshot or not private.message_is_visible(v_message,v_a.reporter_id)
    then raise exception 'Message changed or became unavailable. Please reload and report again'; end if;
  select * into v_e from public.message_report_evidence where message_id=v_message and version=md5(v_a.snapshot::text) for update;
  if v_e.resolved_at is not null then raise exception 'This message has already been reviewed'; end if;
  if v_e.id is null then
    v_count := jsonb_array_length(v_a.snapshot->'attachments');
    for v_i in 0..v_count-1 loop
      if not exists(select 1 from storage.objects where bucket_id='message-report-evidence' and name=p_attempt_id::text||'/'||v_i::text)
        then raise exception 'Evidence is incomplete. Please retry'; end if;
    end loop;
    insert into public.message_report_evidence(id,message_id,snapshot,version)
      values(p_attempt_id,v_message,v_a.snapshot,md5(v_a.snapshot::text)) returning * into v_e;
  end if;
  insert into public.safety_reports(reporter_id,reported_user_id,ride_id,reason,message_evidence_id)
    values(v_a.reporter_id,(v_a.snapshot->>'senderId')::uuid,(v_a.snapshot->>'rideId')::uuid,v_a.reason,v_e.id)
    on conflict (reporter_id,message_evidence_id) where message_evidence_id is not null do nothing returning id into v_id;
  return jsonb_build_object('evidenceId',v_e.id,'reportId',v_id);
end; $$;
revoke all on function public.finish_message_report(uuid) from public, anon, authenticated;
grant execute on function public.finish_message_report(uuid) to service_role;

create function public.admin_message_report_evidence(p_evidence_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_e public.message_report_evidence%rowtype;
begin
  if not private.is_identity_review_admin() then raise exception 'Not authorized'; end if;
  select * into strict v_e from public.message_report_evidence where id=p_evidence_id;
  return jsonb_build_object('id',v_e.id,'snapshot',v_e.snapshot,'purged',v_e.purged_at is not null,'decision',v_e.decision);
end; $$;
revoke all on function public.admin_message_report_evidence(uuid) from public, anon;
grant execute on function public.admin_message_report_evidence(uuid) to authenticated;

create function public.admin_review_message_report(p_evidence_id uuid, p_outcome text, p_reason text, p_remove boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v_e public.message_report_evidence%rowtype; v_actor uuid; v_ride uuid;
begin
  if not private.is_identity_review_admin() then raise exception 'Not authorized'; end if;
  if p_outcome is null or p_outcome not in ('dismissed','warning','confirmed_minor_conduct','confirmed_moderate_conduct','confirmed_serious_conduct','confirmed_severe_conduct')
    then raise exception 'Choose a valid outcome'; end if;
  if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'A review reason of 1–500 characters is required'; end if;
  select * into strict v_e from public.message_report_evidence where id=p_evidence_id;
  perform pg_advisory_xact_lock(hashtextextended(v_e.message_id::text,110));
  select * into strict v_e from public.message_report_evidence where id=p_evidence_id for update;
  if v_e.resolved_at is not null then return; end if;
  v_actor := (v_e.snapshot->>'senderId')::uuid;
  select ride_id into v_ride from public.safety_reports where message_evidence_id=v_e.id limit 1;
  if p_outcome like 'confirmed_%' then
    perform 1 from public.host_impact_stats where user_id=v_actor for update;
    perform private.apply_conduct_outcome(v_actor,p_outcome,'message:'||v_e.id::text,trim(p_reason),v_ride,false);
  end if;
  if p_remove and p_outcome <> 'dismissed' then
    -- Only the offending version is removed; never erase an edited replacement.
    perform 1 from public.messages where id=v_e.message_id for update;
    if private.message_report_snapshot(v_e.message_id) = v_e.snapshot then
      delete from public.message_attachments where message_id=v_e.message_id;
      delete from public.message_ride_invitations where message_id=v_e.message_id;
      update public.messages set text_content=null,deleted_at=now(),moderated_at=now(),edited_at=null where id=v_e.message_id;
    end if;
  end if;
  update public.message_report_evidence set resolved_at=now(),decision=p_outcome where id=v_e.id;
  update public.safety_reports set status=case when p_outcome='dismissed' then 'dismissed' else 'resolved' end,
    resolved_at=now(),resolved_by=auth.uid(),resolution_note=trim(p_reason)
    where message_evidence_id=v_e.id and status='open';
end; $$;
revoke all on function public.admin_review_message_report(uuid,text,text,boolean) from public, anon;
grant execute on function public.admin_review_message_report(uuid,text,text,boolean) to authenticated;

-- Prevent the older queue endpoint from closing a message case without its evidence.
create function private.guard_message_report_resolution() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.message_evidence_id is not null and new.status <> 'open' and not exists(
    select 1 from public.message_report_evidence where id=new.message_evidence_id and resolved_at is not null)
    then raise exception 'Use the message evidence review action'; end if;
  return new;
end; $$;
revoke all on function private.guard_message_report_resolution() from public, anon, authenticated;
create trigger message_report_resolution_guard before update on public.safety_reports
  for each row execute function private.guard_message_report_resolution();
create or replace function public.submit_safety_report(
  p_reported_user_id uuid,
  p_reason text,
  p_ride_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reporter_id uuid := auth.uid();
  v_id uuid;
begin
  if v_reporter_id is null then
    raise exception 'Sign in to report a member';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to report a member';
  end if;
  if p_reported_user_id = v_reporter_id then
    raise exception 'You cannot report yourself';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_reported_user_id and status = 'active'
  ) then
    raise exception 'That member could not be found';
  end if;

  insert into public.safety_reports (reporter_id, reported_user_id, ride_id, reason)
  values (v_reporter_id, p_reported_user_id, p_ride_id, trim(p_reason))
  on conflict (reporter_id, reported_user_id) where status = 'open' and message_evidence_id is null do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'You already have an open report for this member';
  end if;

  return v_id;
end;
$$;

revoke all on function public.submit_safety_report(uuid, text, uuid) from public, anon;
grant execute on function public.submit_safety_report(uuid, text, uuid) to authenticated;


create or replace function public.admin_list_safety_reports(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reports jsonb;
begin
  if not private.is_identity_review_admin() then
    raise exception 'Not authorized to view the safety report queue';
  end if;
  if p_status not in ('open', 'resolved', 'dismissed', 'all') then
    raise exception 'Unknown report status filter: %', p_status;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by
    case when r.status = 'open' then r."createdAt" end asc,
    case when r.status <> 'open' then r."createdAt" end desc
  ), '[]'::jsonb)
  into v_reports
  from (
    select
      sr.id,
      sr.message_evidence_id as "messageEvidenceId",
      sr.reporter_id as "reporterId",
      reporter.full_name as "reporterName",
      sr.reported_user_id as "reportedUserId",
      reported.full_name as "reportedName",
      sr.ride_id as "rideId",
      sr.reason,
      sr.status,
      sr.created_at as "createdAt",
      sr.resolved_at as "resolvedAt",
      sr.resolution_note as "resolutionNote"
    from public.safety_reports sr
    join public.profiles reporter on reporter.id = sr.reporter_id
    join public.profiles reported on reported.id = sr.reported_user_id
    where p_status = 'all' or sr.status = p_status
  ) r;

  return v_reports;
end;
$$;

revoke all on function public.admin_list_safety_reports(text) from public, anon;
grant execute on function public.admin_list_safety_reports(text) to authenticated;

-- Dedicated cleanup token remains in Vault; it grants no general API access.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'), 'm3_message_report_cleanup');
create function public.message_report_cleanup_authorized(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from vault.decrypted_secrets where name='m3_message_report_cleanup'
    and length(p_token)=64 and decrypted_secret=p_token);
$$;
revoke all on function public.message_report_cleanup_authorized(text) from public, anon, authenticated;
grant execute on function public.message_report_cleanup_authorized(text) to service_role;
select cron.schedule('m3-message-report-cleanup', '17 * * * *', $job$
  select net.http_post(
    url := 'https://pnetstmovctfwqcumodx.supabase.co/functions/v1/m3-message-reports',
    headers := jsonb_build_object('Content-Type','application/json','x-cleanup-token',
      (select decrypted_secret from vault.decrypted_secrets where name='m3_message_report_cleanup')),
    body := '{"action":"cleanup"}'::jsonb, timeout_milliseconds := 60000);
$job$);
commit;
