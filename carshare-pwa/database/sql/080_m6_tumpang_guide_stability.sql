-- Module 6: Tumpang Guide stability additions.
--
-- This migration is deliberately additive. It preserves the existing 079
-- schema and RPCs, then adds the batch identity used to keep a recommendation
-- stable while the user changes language, opens Why this, or retries Gemini.
-- No Module 1-5 table, function or policy is changed here.

begin;

alter table public.ai_guide_messages
  add column if not exists batch_id uuid;
alter table public.ai_guide_recommendations
  add column if not exists batch_id uuid;

create index if not exists ai_guide_messages_owner_batch_idx
  on public.ai_guide_messages (owner_id, session_id, batch_id, created_at desc)
  where batch_id is not null;
create index if not exists ai_guide_recommendations_owner_batch_idx
  on public.ai_guide_recommendations (owner_id, session_id, batch_id, rank)
  where batch_id is not null;

alter table public.ai_guide_sessions
  drop constraint if exists ai_guide_sessions_language_check;
alter table public.ai_guide_sessions
  add constraint ai_guide_sessions_language_check
  check (language ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$');

alter table public.ai_help_sections
  drop constraint if exists ai_help_sections_language_check;
alter table public.ai_help_sections
  add constraint ai_help_sections_language_check
  check (language ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$');

create table if not exists private.ai_guide_language_packs (
  language_tag text not null
    check (language_tag ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'),
  pack_version text not null
    check (char_length(pack_version) between 1 and 80),
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (language_tag, pack_version)
);

alter table private.ai_guide_language_packs enable row level security;
revoke all on table private.ai_guide_language_packs from public, anon, authenticated;
grant all on table private.ai_guide_language_packs to service_role;

-- The v2 function is intentionally a full server-owned write path instead of
-- wrapping 079: 079 accepts only the original four core language tags.
create or replace function public.m6_guide_persist_turn_v2(
  p_owner_id uuid,
  p_session_id uuid,
  p_language text,
  p_plan_state jsonb,
  p_user_message text,
  p_assistant_response jsonb,
  p_recommendations jsonb,
  p_prompt_version text,
  p_model_name text,
  p_batch_id uuid,
  p_trace_id text,
  p_latency_ms integer,
  p_fallback_reason text,
  p_validation_result jsonb,
  p_candidate_place_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The explicit schema is required because this function intentionally uses
  -- an empty search_path. Supabase installs pgcrypto helpers in extensions.
  v_session_id uuid := coalesce(p_session_id, extensions.gen_random_uuid());
  v_assistant_message_id uuid;
  v_title text := left(coalesce(nullif(btrim(p_user_message), ''), 'New travel plan'), 120);
begin
  if p_owner_id is null
     or not exists (select 1 from public.profiles where id = p_owner_id)
     or p_language is null
     or p_language !~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'
     or jsonb_typeof(coalesce(p_plan_state, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_assistant_response, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_recommendations, '[]'::jsonb)) <> 'array'
     or nullif(btrim(coalesce(p_trace_id, '')), '') is null then
    raise exception 'Invalid Guide persistence payload';
  end if;

  if exists (
    select 1 from public.ai_guide_sessions
    where id = v_session_id and owner_id <> p_owner_id
  ) then
    raise exception 'Guide session ownership mismatch';
  end if;

  insert into public.ai_guide_sessions (
    id, owner_id, language, title, plan_state, trip_history_consent
  ) values (
    v_session_id, p_owner_id, p_language, v_title, p_plan_state,
    coalesce((p_plan_state->>'tripHistoryConsent')::boolean, false)
  )
  on conflict (id) do update set
    language = excluded.language,
    plan_state = excluded.plan_state,
    trip_history_consent = excluded.trip_history_consent,
    updated_at = now(),
    expires_at = now() + interval '90 days';

  insert into public.ai_guide_messages (session_id, owner_id, role, content)
  values (v_session_id, p_owner_id, 'user', left(p_user_message, 4000));

  insert into public.ai_guide_messages (
    session_id, owner_id, role, content, structured_payload, trace_id, batch_id
  ) values (
    v_session_id, p_owner_id, 'assistant',
    left(coalesce(p_assistant_response->>'assistantMessage', 'Guide response'), 4000),
    p_assistant_response, p_trace_id, p_batch_id
  ) returning id into v_assistant_message_id;

  insert into public.ai_guide_recommendations (
    session_id, message_id, owner_id, place_id, rank,
    recommendation_role, verified_reason_codes, tradeoff_code, evidence,
    prompt_version, model_name, trace_id, batch_id
  )
  select
    v_session_id, v_assistant_message_id, p_owner_id,
    (item->>'placeId')::uuid, ordinal::smallint,
    item->>'role',
    coalesce(array(select jsonb_array_elements_text(item->'verifiedReasonCodes')), '{}'),
    item->>'tradeoffCode',
    coalesce(item->'evidence', '{}'::jsonb),
    p_prompt_version, p_model_name, p_trace_id, p_batch_id
  from jsonb_array_elements(p_recommendations) with ordinality as recommendations(item, ordinal)
  where ordinal <= 3;

  insert into private.ai_guide_traces (
    trace_id, session_id, owner_id, mode, prompt_version, model_name,
    latency_ms, fallback_reason, validation_result, candidate_place_ids, shown_place_ids
  ) values (
    p_trace_id, v_session_id, p_owner_id,
    coalesce(p_assistant_response->>'mode', 'fallback'), p_prompt_version, p_model_name,
    greatest(0, coalesce(p_latency_ms, 0)), p_fallback_reason,
    coalesce(p_validation_result, '{}'::jsonb), coalesce(p_candidate_place_ids, '{}'),
    coalesce(array(
      select (item->>'placeId')::uuid from jsonb_array_elements(p_recommendations) item
    ), '{}')
  );

  return v_session_id;
end;
$$;

-- Retry updates the assistant explanation in place. It does not append a new
-- user message or a second set of recommendation rows for the same batch.
create or replace function public.m6_guide_upgrade_batch(
  p_owner_id uuid,
  p_session_id uuid,
  p_batch_id uuid,
  p_language text,
  p_plan_state jsonb,
  p_assistant_response jsonb,
  p_prompt_version text,
  p_model_name text,
  p_trace_id text,
  p_latency_ms integer,
  p_fallback_reason text,
  p_validation_result jsonb,
  p_candidate_place_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
begin
  if p_owner_id is null or p_session_id is null or p_batch_id is null
     or p_language is null or p_language !~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'
     or jsonb_typeof(coalesce(p_plan_state, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_assistant_response, '{}'::jsonb)) <> 'object'
     or nullif(btrim(coalesce(p_trace_id, '')), '') is null then
    raise exception 'Invalid Guide batch upgrade payload';
  end if;
  if not exists (
    select 1 from public.ai_guide_sessions
    where id = p_session_id and owner_id = p_owner_id
  ) then
    raise exception 'Guide session ownership mismatch';
  end if;

  update public.ai_guide_sessions
  set language = p_language, plan_state = p_plan_state,
      trip_history_consent = coalesce((p_plan_state->>'tripHistoryConsent')::boolean, false),
      updated_at = now(), expires_at = now() + interval '90 days'
  where id = p_session_id and owner_id = p_owner_id;

  update public.ai_guide_messages
  set content = left(coalesce(p_assistant_response->>'assistantMessage', 'Guide response'), 4000),
      structured_payload = p_assistant_response,
      trace_id = p_trace_id
  where id = (
    select id from public.ai_guide_messages
    where session_id = p_session_id and owner_id = p_owner_id
      and role = 'assistant' and batch_id = p_batch_id
    order by created_at desc limit 1
  )
  returning id into v_message_id;

  if v_message_id is null then return false; end if;

  update public.ai_guide_recommendations
  set trace_id = p_trace_id, prompt_version = p_prompt_version, model_name = p_model_name
  where session_id = p_session_id and owner_id = p_owner_id and batch_id = p_batch_id;

  insert into private.ai_guide_traces (
    trace_id, session_id, owner_id, mode, prompt_version, model_name,
    latency_ms, fallback_reason, validation_result, candidate_place_ids, shown_place_ids
  ) values (
    p_trace_id, p_session_id, p_owner_id,
    coalesce(p_assistant_response->>'mode', 'fallback'), p_prompt_version, p_model_name,
    greatest(0, coalesce(p_latency_ms, 0)), p_fallback_reason,
    coalesce(p_validation_result, '{}'::jsonb), coalesce(p_candidate_place_ids, '{}'),
    coalesce(array(
      select (item->>'placeId')::uuid
      from jsonb_array_elements(coalesce(p_assistant_response->'recommendations', '[]'::jsonb)) item
    ), '{}')
  );
  return true;
end;
$$;

create or replace function public.m6_guide_cache_translation(
  p_owner_id uuid,
  p_session_id uuid,
  p_trace_id text,
  p_language text,
  p_content text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_owner_id is null or p_session_id is null
     or p_trace_id is null or p_trace_id = ''
     or p_language is null or p_language !~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'
     or p_content is null or char_length(p_content) not between 1 and 4000 then
    raise exception 'Invalid Guide translation payload';
  end if;
  if not exists (
    select 1 from public.ai_guide_sessions
    where id = p_session_id and owner_id = p_owner_id
  ) then
    raise exception 'Guide session ownership mismatch';
  end if;
  update public.ai_guide_messages
  set structured_payload = jsonb_set(
    coalesce(structured_payload, '{}'::jsonb),
    array['localizedMessages', p_language],
    to_jsonb(p_content), true
  )
  where session_id = p_session_id and owner_id = p_owner_id
    and role = 'assistant' and trace_id = p_trace_id;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.m6_guide_clear_feedback(
  p_owner_id uuid,
  p_session_id uuid,
  p_trace_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_owner_id is null or p_session_id is null or nullif(btrim(coalesce(p_trace_id, '')), '') is null
     or not exists (
       select 1 from public.ai_guide_sessions
       where id = p_session_id and owner_id = p_owner_id
     ) then
    raise exception 'Guide session ownership mismatch';
  end if;
  delete from public.ai_guide_feedback
  where owner_id = p_owner_id and session_id = p_session_id and trace_id = p_trace_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.m6_guide_persist_turn_v2(uuid, uuid, text, jsonb, text, jsonb, jsonb, text, text, uuid, text, integer, text, jsonb, uuid[])
  from public, anon, authenticated;
revoke all on function public.m6_guide_upgrade_batch(uuid, uuid, uuid, text, jsonb, jsonb, text, text, text, integer, text, jsonb, uuid[])
  from public, anon, authenticated;
revoke all on function public.m6_guide_cache_translation(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.m6_guide_clear_feedback(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.m6_guide_persist_turn_v2(uuid, uuid, text, jsonb, text, jsonb, jsonb, text, text, uuid, text, integer, text, jsonb, uuid[])
  to service_role;
grant execute on function public.m6_guide_upgrade_batch(uuid, uuid, uuid, text, jsonb, jsonb, text, text, text, integer, text, jsonb, uuid[])
  to service_role;
grant execute on function public.m6_guide_cache_translation(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.m6_guide_clear_feedback(uuid, uuid, text)
  to service_role;

commit;
