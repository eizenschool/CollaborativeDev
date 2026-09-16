-- Notify members when administrators finish profile or message safety reviews.
-- Depends on project_notifications, M1 conduct/report functions and M3 message reports.

create or replace function public.admin_apply_conduct_outcome(
  p_user_id uuid,
  p_event_type text,
  p_reason text,
  p_ride_id uuid default null,
  p_set_hold boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_event_id text := gen_random_uuid()::text;
  v_applied boolean;
  v_effective_type text;
  v_delta integer;
begin
  if not private.is_identity_review_admin() then
    raise exception 'Not authorized to confirm a Trust Case';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to confirm a Trust Case';
  end if;

  v_applied := private.apply_conduct_outcome(
    p_user_id, p_event_type, v_source_event_id, p_reason, p_ride_id, p_set_hold
  );

  if v_applied then
    select event_type, delta into strict v_effective_type, v_delta
    from public.reputation_events
    where user_id = p_user_id
      and source_module = 'Safety'
      and source_event_id = v_source_event_id;

    perform private.create_user_notification(
      p_user_id, 'm1', 'conduct_outcome', 'Account safety action',
      'An administrator confirmed a conduct violation. Your reputation was reduced by '
        || abs(v_delta)::text || ' points.',
      '/profile?panel=reputation',
      jsonb_build_object('eventType', v_effective_type, 'delta', v_delta, 'rideId', p_ride_id),
      'conduct-outcome:' || v_source_event_id
    );
  end if;
  return v_applied;
end;
$$;

revoke all on function public.admin_apply_conduct_outcome(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.admin_apply_conduct_outcome(uuid, text, text, uuid, boolean) to authenticated;

create or replace function public.admin_resolve_safety_report(
  p_report_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.safety_reports%rowtype;
begin
  if not private.is_identity_review_admin() then raise exception 'Not authorized to resolve a safety report'; end if;
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'A resolved report must be marked resolved or dismissed';
  end if;

  select * into v_report from public.safety_reports
  where id = p_report_id and status = 'open' for update;
  if v_report.id is null then raise exception 'That report is no longer open'; end if;

  update public.safety_reports
  set status = p_status, resolved_at = now(), resolved_by = auth.uid(), resolution_note = p_note
  where id = v_report.id;

  perform private.create_user_notification(
    v_report.reporter_id, 'm1', 'safety_report_result', 'Report reviewed',
    case when p_status = 'dismissed'
      then 'The safety team reviewed your report and did not find a violation.'
      else 'The safety team reviewed your report and took appropriate action.' end,
    '/notifications',
    jsonb_build_object(
      'reportId', v_report.id,
      'result', case when p_status = 'dismissed' then 'no_violation' else 'action_taken' end,
      'rideId', v_report.ride_id
    ),
    'safety-report-result:' || v_report.id::text
  );
end;
$$;

revoke all on function public.admin_resolve_safety_report(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_safety_report(uuid, text, text) to authenticated;

create or replace function public.admin_review_message_report(
  p_evidence_id uuid,
  p_outcome text,
  p_reason text,
  p_remove boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.message_report_evidence%rowtype;
  v_actor uuid;
  v_ride uuid;
  v_source_event_id text;
  v_applied boolean := false;
  v_effective_type text;
  v_delta integer;
begin
  if not private.is_identity_review_admin() then raise exception 'Not authorized'; end if;
  if p_outcome is null or p_outcome not in (
    'dismissed', 'warning', 'confirmed_minor_conduct', 'confirmed_moderate_conduct',
    'confirmed_serious_conduct', 'confirmed_severe_conduct'
  ) then raise exception 'Choose a valid outcome'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'A review reason of 1–500 characters is required';
  end if;

  select * into strict v_e from public.message_report_evidence where id = p_evidence_id;
  perform pg_advisory_xact_lock(hashtextextended(v_e.message_id::text, 110));
  select * into strict v_e from public.message_report_evidence where id = p_evidence_id for update;
  if v_e.resolved_at is not null then return; end if;

  v_actor := (v_e.snapshot->>'senderId')::uuid;
  v_source_event_id := 'message:' || v_e.id::text;
  select ride_id into v_ride from public.safety_reports where message_evidence_id = v_e.id limit 1;

  if p_outcome like 'confirmed_%' then
    perform 1 from public.host_impact_stats where user_id = v_actor for update;
    v_applied := private.apply_conduct_outcome(
      v_actor, p_outcome, v_source_event_id, trim(p_reason), v_ride, false
    );
    if v_applied then
      select event_type, delta into strict v_effective_type, v_delta
      from public.reputation_events
      where user_id = v_actor and source_module = 'Safety' and source_event_id = v_source_event_id;
    end if;
  end if;

  if p_remove and p_outcome <> 'dismissed' then
    perform 1 from public.messages where id = v_e.message_id for update;
    if private.message_report_snapshot(v_e.message_id) = v_e.snapshot then
      delete from public.message_attachments where message_id = v_e.message_id;
      delete from public.message_ride_invitations where message_id = v_e.message_id;
      update public.messages set text_content = null, deleted_at = now(), moderated_at = now(), edited_at = null
      where id = v_e.message_id;
    end if;
  end if;

  perform private.create_user_notification(
    sr.reporter_id, 'm3', 'message_report_result', 'Message report reviewed',
    case when p_outcome = 'dismissed'
      then 'The safety team reviewed the message and did not find a violation.'
      else 'The safety team reviewed the message and took appropriate action.' end,
    '/notifications',
    jsonb_build_object(
      'reportId', sr.id,
      'result', case when p_outcome = 'dismissed' then 'no_violation' else 'action_taken' end,
      'rideId', sr.ride_id
    ),
    'message-report-result:' || sr.id::text
  ) from public.safety_reports sr
  where sr.message_evidence_id = v_e.id and sr.status = 'open';

  if p_outcome = 'warning' then
    perform private.create_user_notification(
      v_actor, 'm3', 'message_conduct_warning', 'Message safety warning',
      'An administrator found that one of your messages violated the community rules. No reputation points were deducted.',
      '/profile?panel=reputation',
      jsonb_build_object('evidenceId', v_e.id, 'delta', 0, 'messageRemoved', p_remove),
      'message-report-subject:' || v_e.id::text
    );
  elsif v_applied then
    perform private.create_user_notification(
      v_actor, 'm3', 'message_conduct_outcome', 'Message safety action',
      'An administrator confirmed that one of your messages violated the community rules. Your reputation was reduced by '
        || abs(v_delta)::text || ' points.',
      '/profile?panel=reputation',
      jsonb_build_object(
        'evidenceId', v_e.id, 'eventType', v_effective_type, 'delta', v_delta,
        'rideId', v_ride, 'messageRemoved', p_remove
      ),
      'message-report-subject:' || v_e.id::text
    );
  end if;

  update public.message_report_evidence set resolved_at = now(), decision = p_outcome where id = v_e.id;
  update public.safety_reports
  set status = case when p_outcome = 'dismissed' then 'dismissed' else 'resolved' end,
      resolved_at = now(), resolved_by = auth.uid(), resolution_note = trim(p_reason)
  where message_evidence_id = v_e.id and status = 'open';
end;
$$;

revoke all on function public.admin_review_message_report(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_review_message_report(uuid, text, text, boolean) to authenticated;
