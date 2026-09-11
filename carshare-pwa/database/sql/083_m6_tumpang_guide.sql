-- Module 6: Tumpang Guide controlled-RAG assistant.
--
-- This migration is additive. It does not change the destination catalogue,
-- Ride, Profile, Messaging, Search/Favourite, or Trip/Eco schemas. Browser
-- clients can read/delete only their own saved Guide history. Every AI write,
-- quota decision, trace, embedding and catalogue workflow is server-owned.

create extension if not exists vector with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private, 90-day Guide conversations
-- ---------------------------------------------------------------------------

create table public.ai_guide_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  language text not null default 'en'
    check (language in ('en', 'zh-CN', 'ms', 'ta')),
  title text not null default 'New travel plan'
    check (char_length(title) between 1 and 120),
  plan_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(plan_state) = 'object'),
  trip_history_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

create index ai_guide_sessions_owner_updated_idx
  on public.ai_guide_sessions (owner_id, updated_at desc);
create index ai_guide_sessions_expiry_idx
  on public.ai_guide_sessions (expires_at);

create table public.ai_guide_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_guide_sessions(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  structured_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(structured_payload) = 'object'),
  trace_id text check (trace_id is null or char_length(trace_id) between 1 and 160),
  created_at timestamptz not null default now()
);

create index ai_guide_messages_session_created_idx
  on public.ai_guide_messages (session_id, created_at);
create index ai_guide_messages_owner_created_idx
  on public.ai_guide_messages (owner_id, created_at desc);

create table public.ai_guide_recommendations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_guide_sessions(id) on delete cascade,
  message_id uuid not null references public.ai_guide_messages(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete restrict,
  rank smallint not null check (rank between 1 and 3),
  recommendation_role text not null
    check (recommendation_role in ('best_match', 'practical_alternative', 'wildcard')),
  verified_reason_codes text[] not null default '{}',
  tradeoff_code text not null,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  prompt_version text not null,
  model_name text not null,
  trace_id text not null,
  created_at timestamptz not null default now(),
  constraint ai_guide_recommendations_message_rank_key unique (message_id, rank),
  constraint ai_guide_recommendations_message_place_key unique (message_id, place_id)
);

create index ai_guide_recommendations_owner_created_idx
  on public.ai_guide_recommendations (owner_id, created_at desc);
create index ai_guide_recommendations_place_created_idx
  on public.ai_guide_recommendations (place_id, created_at desc);

create table public.ai_guide_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_guide_sessions(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  trace_id text not null,
  sentiment text not null check (sentiment in ('up', 'down')),
  reason_code text not null
    check (reason_code in ('helpful', 'not_relevant', 'bad_tradeoff', 'wrong_language', 'other')),
  created_at timestamptz not null default now(),
  constraint ai_guide_feedback_owner_trace_key unique (owner_id, trace_id)
);

create index ai_guide_feedback_session_created_idx
  on public.ai_guide_feedback (session_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Versioned Help RAG and place enrichment
-- ---------------------------------------------------------------------------

create table public.ai_help_sections (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null check (char_length(stable_key) between 1 and 100),
  language text not null check (language in ('en', 'zh-CN', 'ms', 'ta')),
  version integer not null check (version >= 1),
  title text not null check (char_length(title) between 1 and 180),
  content text not null check (char_length(content) between 1 and 6000),
  keywords text[] not null default '{}',
  source_path text not null check (char_length(source_path) between 1 and 300),
  embedding extensions.vector(768),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_help_sections_key_language_version_key
    unique (stable_key, language, version)
);

create index ai_help_sections_active_language_idx
  on public.ai_help_sections (language, stable_key, version desc)
  where is_active;
create index ai_help_sections_embedding_hnsw_idx
  on public.ai_help_sections using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null and is_active;

insert into public.ai_help_sections (
  stable_key, language, version, title, content, keywords, source_path
) values
  ('discover', 'en', 1, 'Discover destinations', 'Discover lists verified catalogue destinations. Tumpang Guide narrows that same catalogue, and Why this opens the full destination evidence page.', array['discover','destination','recommend'], 'docs/ai/modules/M6_DESTINATION_DISCOVERY.md'),
  ('ride-search', 'en', 1, 'Find a Ride', 'After you choose a destination, Find a ride opens Search with its official Place ID, destination name and selected date prefilled.', array['ride','search','seat','prefill'], 'docs/ai/FR-6.35_PREFILL_CONTRACT.md'),
  ('privacy', 'en', 1, 'Guide privacy', 'Guest Guide chats are not saved. Signed-in Guide chats are private, can be deleted, and expire after 90 days. Trip History is used only after session consent.', array['privacy','history','delete','save'], 'docs/TUMPANG-GUIDE.md'),
  ('alerts', 'en', 1, 'Ride alerts', 'A signed-in traveller can confirm a Ride availability alert for a selected catalogue destination and date. Alerts use the existing notification centre.', array['alert','notification','ride'], 'docs/ai/modules/M6_DESTINATION_DISCOVERY.md'),
  ('discover', 'zh-CN', 1, '探索目的地', 'Discover 只显示已验证的数据库地点。Tumpang Guide 会在同一目录中筛选，Why this 会打开完整的目的地证据页面。', array['探索','目的地','推荐'], 'docs/ai/modules/M6_DESTINATION_DISCOVERY.md'),
  ('ride-search', 'zh-CN', 1, '寻找共乘', '选定目的地后，Find a ride 会把正式 Place ID、目的地名称和日期自动填入 Search。', array['共乘','搜索','座位','自动填入'], 'docs/ai/FR-6.35_PREFILL_CONTRACT.md'),
  ('privacy', 'zh-CN', 1, 'Guide 隐私', '访客对话不会保存。登入后的 Guide 对话为私人资料，可删除并在 90 天后到期。Trip History 仅在本次会话授权后使用。', array['隐私','历史','删除','保存'], 'docs/TUMPANG-GUIDE.md'),
  ('alerts', 'zh-CN', 1, '共乘提醒', '登入用户确认后，可以为选定的数据库目的地和日期登记 Ride availability 提醒，并使用现有通知中心接收结果。', array['提醒','通知','共乘'], 'docs/ai/modules/M6_DESTINATION_DISCOVERY.md'),
  ('discover', 'ms', 1, 'Terokai destinasi', 'Discover hanya memaparkan destinasi katalog yang disahkan. Tumpang Guide menapis katalog yang sama dan Why this membuka halaman bukti destinasi penuh.', array['terokai','destinasi','cadangan'], 'docs/ai/modules/M6_DESTINATION_DISCOVERY.md'),
  ('ride-search', 'ms', 1, 'Cari Ride', 'Selepas memilih destinasi, Find a ride membuka Search dengan Place ID rasmi, nama destinasi dan tarikh yang telah diisi.', array['ride','carian','tempat duduk'], 'docs/ai/FR-6.35_PREFILL_CONTRACT.md'),
  ('privacy', 'ms', 1, 'Privasi Guide', 'Sembang tetamu tidak disimpan. Sembang pengguna berdaftar adalah peribadi, boleh dipadam dan tamat selepas 90 hari. Trip History digunakan hanya selepas persetujuan sesi.', array['privasi','sejarah','padam','simpan'], 'docs/TUMPANG-GUIDE.md'),
  ('alerts', 'ms', 1, 'Amaran Ride', 'Pengguna berdaftar boleh mengesahkan amaran ketersediaan Ride untuk destinasi katalog dan tarikh yang dipilih melalui pusat notifikasi sedia ada.', array['amaran','notifikasi','ride'], 'docs/ai/modules/M6_DESTINATION_DISCOVERY.md'),
  ('discover', 'ta', 1, 'இடங்களை கண்டறியுங்கள்', 'Discover சரிபார்க்கப்பட்ட பட்டியல் இடங்களை மட்டும் காட்டுகிறது. Tumpang Guide அதே பட்டியலை வடிகட்டி, Why this முழு ஆதாரப் பக்கத்தைத் திறக்கிறது.', array['இடம்','பரிந்துரை','discover'], 'docs/ai/modules/M6_DESTINATION_DISCOVERY.md'),
  ('ride-search', 'ta', 1, 'Ride தேடுங்கள்', 'ஒரு இடத்தைத் தேர்ந்தெடுத்த பிறகு, Find a ride அதன் அதிகாரப்பூர்வ Place ID, பெயர் மற்றும் தேதியுடன் Search பக்கத்தைத் திறக்கும்.', array['ride','தேடல்','இருக்கை'], 'docs/ai/FR-6.35_PREFILL_CONTRACT.md'),
  ('privacy', 'ta', 1, 'Guide தனியுரிமை', 'விருந்தினர் உரையாடல்கள் சேமிக்கப்படாது. உள்நுழைந்த Guide உரையாடல்கள் தனிப்பட்டவை, நீக்கக்கூடியவை, 90 நாட்களில் காலாவதியாகும். அமர்வு அனுமதிக்குப் பிறகே Trip History பயன்படுத்தப்படும்.', array['தனியுரிமை','வரலாறு','நீக்கு'], 'docs/TUMPANG-GUIDE.md'),
  ('alerts', 'ta', 1, 'Ride அறிவிப்பு', 'உள்நுழைந்த பயனர் தேர்ந்தெடுத்த பட்டியல் இடம் மற்றும் தேதிக்கான Ride அறிவிப்பை உறுதிப்படுத்தி, ஏற்கனவே உள்ள அறிவிப்பு மையத்தில் முடிவைப் பெறலாம்.', array['அறிவிப்பு','ride','பயணம்'], 'docs/ai/modules/M6_DESTINATION_DISCOVERY.md')
on conflict (stable_key, language, version) do update set
  title = excluded.title,
  content = excluded.content,
  keywords = excluded.keywords,
  source_path = excluded.source_path,
  is_active = true,
  updated_at = now();

create table public.place_travel_attributes (
  place_id uuid primary key references public.places(id) on delete cascade,
  price_level smallint check (price_level between 0 and 4),
  opening_hours jsonb not null default '{}'::jsonb
    check (jsonb_typeof(opening_hours) = 'object'),
  indoor_outdoor text not null default 'unknown'
    check (indoor_outdoor in ('indoor', 'outdoor', 'mixed', 'unknown')),
  suitable_for_children boolean,
  suitable_for_groups boolean,
  has_restroom boolean,
  has_parking boolean,
  wheelchair_accessible boolean,
  typical_stay_minutes integer
    check (typical_stay_minutes is null or typical_stay_minutes between 15 and 1440),
  review_soft_signals jsonb not null default '{}'::jsonb
    check (jsonb_typeof(review_soft_signals) = 'object'),
  review_signals_observed_at timestamptz,
  field_provenance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(field_provenance) = 'object'),
  enriched_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Database-external place requests
-- ---------------------------------------------------------------------------

create table public.place_catalogue_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requested_name text not null check (char_length(requested_name) between 2 and 160),
  normalized_name text not null check (char_length(normalized_name) between 2 and 160),
  support_count integer not null default 1 check (support_count >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'accepted', 'rejected')),
  rejection_reason text
    check (rejection_reason is null or rejection_reason in
      ('not_in_malaysia', 'unsupported_category', 'duplicate_place', 'insufficient_source_data', 'not_found')),
  resolved_place_id uuid references public.places(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint place_catalogue_requests_requester_name_key
    unique (requester_id, normalized_name)
);

create index place_catalogue_requests_weekly_queue_idx
  on public.place_catalogue_requests (status, support_count desc, created_at)
  where status = 'pending';
create index place_catalogue_requests_normalized_name_idx
  on public.place_catalogue_requests (normalized_name);

-- ---------------------------------------------------------------------------
-- Private usage and trace data
-- ---------------------------------------------------------------------------

create table private.ai_guide_usage (
  actor_key text not null,
  usage_date date not null,
  user_id uuid references public.profiles(id) on delete cascade,
  successful_turns integer not null default 0 check (successful_turns >= 0),
  burst_window_started_at timestamptz not null default now(),
  burst_count integer not null default 0 check (burst_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (actor_key, usage_date)
);

create index ai_guide_usage_user_date_idx
  on private.ai_guide_usage (user_id, usage_date desc)
  where user_id is not null;

create table private.ai_guide_traces (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null unique,
  session_id uuid references public.ai_guide_sessions(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete cascade,
  mode text not null,
  prompt_version text not null,
  model_name text not null,
  latency_ms integer not null default 0 check (latency_ms >= 0),
  fallback_reason text,
  validation_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(validation_result) = 'object'),
  candidate_place_ids uuid[] not null default '{}',
  shown_place_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index ai_guide_traces_created_idx on private.ai_guide_traces (created_at desc);
create index ai_guide_traces_owner_created_idx
  on private.ai_guide_traces (owner_id, created_at desc)
  where owner_id is not null;

-- ---------------------------------------------------------------------------
-- RLS and explicit Data API grants
-- ---------------------------------------------------------------------------

alter table public.ai_guide_sessions enable row level security;
alter table public.ai_guide_messages enable row level security;
alter table public.ai_guide_recommendations enable row level security;
alter table public.ai_guide_feedback enable row level security;
alter table public.ai_help_sections enable row level security;
alter table public.place_travel_attributes enable row level security;
alter table public.place_catalogue_requests enable row level security;

create policy "guide owners read their sessions"
  on public.ai_guide_sessions for select to authenticated
  using ((select auth.uid()) = owner_id and expires_at > now());
create policy "guide owners delete their sessions"
  on public.ai_guide_sessions for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "guide owners read their messages"
  on public.ai_guide_messages for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "guide owners read shown recommendations"
  on public.ai_guide_recommendations for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "guide owners read their feedback"
  on public.ai_guide_feedback for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "guide requesters read their catalogue requests"
  on public.place_catalogue_requests for select to authenticated
  using ((select auth.uid()) = requester_id);

revoke all on table public.ai_guide_sessions from public, anon, authenticated;
revoke all on table public.ai_guide_messages from public, anon, authenticated;
revoke all on table public.ai_guide_recommendations from public, anon, authenticated;
revoke all on table public.ai_guide_feedback from public, anon, authenticated;
revoke all on table public.ai_help_sections from public, anon, authenticated;
revoke all on table public.place_travel_attributes from public, anon, authenticated;
revoke all on table public.place_catalogue_requests from public, anon, authenticated;

grant select, delete on table public.ai_guide_sessions to authenticated;
grant select on table public.ai_guide_messages to authenticated;
grant select on table public.ai_guide_recommendations to authenticated;
grant select on table public.ai_guide_feedback to authenticated;
grant select on table public.place_catalogue_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Server-only quota and atomic persistence interfaces
-- ---------------------------------------------------------------------------

create or replace function public.m6_match_ai_help(
  p_language text,
  p_embedding extensions.vector(768),
  p_limit integer default 3
)
returns table (
  stable_key text,
  title text,
  content text,
  source_path text,
  similarity double precision
)
language sql
stable
security definer
set search_path = extensions, pg_catalog
as $$
  select h.stable_key, h.title, h.content, h.source_path,
         (1 - (h.embedding <=> p_embedding))::double precision as similarity
  from public.ai_help_sections h
  where h.language = p_language and h.is_active and h.embedding is not null
  order by h.embedding <=> p_embedding
  limit least(greatest(coalesce(p_limit, 3), 1), 5);
$$;

create or replace function public.m6_guide_check_quota(
  p_actor_key text,
  p_user_id uuid,
  p_daily_limit integer,
  p_burst_limit integer,
  p_global_key text,
  p_global_daily_limit integer,
  p_global_burst_limit integer
)
returns table (allowed boolean, remaining integer, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_actor private.ai_guide_usage%rowtype;
  v_global private.ai_guide_usage%rowtype;
begin
  if nullif(btrim(coalesce(p_actor_key, '')), '') is null
     or nullif(btrim(coalesce(p_global_key, '')), '') is null
     or p_daily_limit < 1 or p_burst_limit < 1
     or p_global_daily_limit < 1 or p_global_burst_limit < 1 then
    raise exception 'Invalid Guide quota request';
  end if;

  insert into private.ai_guide_usage (actor_key, usage_date, user_id)
  values (p_actor_key, v_date, p_user_id)
  on conflict (actor_key, usage_date) do nothing;
  insert into private.ai_guide_usage (actor_key, usage_date)
  values (p_global_key, v_date)
  on conflict (actor_key, usage_date) do nothing;

  select * into v_actor from private.ai_guide_usage
  where actor_key = p_actor_key and usage_date = v_date for update;
  select * into v_global from private.ai_guide_usage
  where actor_key = p_global_key and usage_date = v_date for update;

  if v_actor.burst_window_started_at < now() - interval '1 minute' then
    v_actor.burst_window_started_at := now();
    v_actor.burst_count := 0;
  end if;
  if v_global.burst_window_started_at < now() - interval '1 minute' then
    v_global.burst_window_started_at := now();
    v_global.burst_count := 0;
  end if;

  if v_actor.successful_turns >= p_daily_limit then
    return query select false, 0, 'rate_limit'; return;
  end if;
  if v_global.successful_turns >= p_global_daily_limit then
    return query select false, 0, 'global_rate_limit'; return;
  end if;
  if v_actor.burst_count >= p_burst_limit or v_global.burst_count >= p_global_burst_limit then
    return query select false, greatest(0, p_daily_limit - v_actor.successful_turns), 'burst_limit'; return;
  end if;

  update private.ai_guide_usage
  set burst_window_started_at = v_actor.burst_window_started_at,
      burst_count = v_actor.burst_count + 1,
      updated_at = now()
  where actor_key = p_actor_key and usage_date = v_date;
  update private.ai_guide_usage
  set burst_window_started_at = v_global.burst_window_started_at,
      burst_count = v_global.burst_count + 1,
      updated_at = now()
  where actor_key = p_global_key and usage_date = v_date;

  return query select true, greatest(0, p_daily_limit - v_actor.successful_turns), null::text;
end;
$$;

create or replace function public.m6_guide_record_success(
  p_actor_key text,
  p_global_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  update private.ai_guide_usage
  set successful_turns = successful_turns + 1, updated_at = now()
  where actor_key in (p_actor_key, p_global_key) and usage_date = v_date;
end;
$$;

create or replace function public.m6_guide_persist_turn(
  p_owner_id uuid,
  p_session_id uuid,
  p_language text,
  p_plan_state jsonb,
  p_user_message text,
  p_assistant_response jsonb,
  p_recommendations jsonb,
  p_prompt_version text,
  p_model_name text,
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
  v_session_id uuid := coalesce(p_session_id, gen_random_uuid());
  v_assistant_message_id uuid;
  v_title text := left(coalesce(nullif(btrim(p_user_message), ''), 'New travel plan'), 120);
begin
  if p_owner_id is null or not exists (select 1 from public.profiles where id = p_owner_id) then
    raise exception 'A valid Guide owner is required';
  end if;
  if p_language not in ('en', 'zh-CN', 'ms', 'ta')
     or jsonb_typeof(coalesce(p_plan_state, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_assistant_response, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_recommendations, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid Guide persistence payload';
  end if;

  if exists (select 1 from public.ai_guide_sessions where id = v_session_id and owner_id <> p_owner_id) then
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
    session_id, owner_id, role, content, structured_payload, trace_id
  ) values (
    v_session_id, p_owner_id, 'assistant',
    left(coalesce(p_assistant_response->>'assistantMessage', 'Guide response'), 4000),
    p_assistant_response, p_trace_id
  ) returning id into v_assistant_message_id;

  insert into public.ai_guide_recommendations (
    session_id, message_id, owner_id, place_id, rank,
    recommendation_role, verified_reason_codes, tradeoff_code, evidence,
    prompt_version, model_name, trace_id
  )
  select
    v_session_id, v_assistant_message_id, p_owner_id,
    (item->>'placeId')::uuid, ordinal::smallint,
    item->>'role',
    coalesce(array(select jsonb_array_elements_text(item->'verifiedReasonCodes')), '{}'),
    item->>'tradeoffCode',
    coalesce(item->'evidence', '{}'::jsonb),
    p_prompt_version, p_model_name, p_trace_id
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

create or replace function public.m6_guide_save_feedback(
  p_owner_id uuid,
  p_session_id uuid,
  p_trace_id text,
  p_sentiment text,
  p_reason_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.ai_guide_sessions
    where id = p_session_id and owner_id = p_owner_id
  ) then raise exception 'Guide session ownership mismatch'; end if;

  insert into public.ai_guide_feedback (
    session_id, owner_id, trace_id, sentiment, reason_code
  ) values (p_session_id, p_owner_id, p_trace_id, p_sentiment, p_reason_code)
  on conflict (owner_id, trace_id) do update set
    sentiment = excluded.sentiment, reason_code = excluded.reason_code
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.m6_guide_record_guest_trace(
  p_trace_id text,
  p_mode text,
  p_prompt_version text,
  p_model_name text,
  p_latency_ms integer,
  p_fallback_reason text,
  p_validation_result jsonb,
  p_candidate_place_ids uuid[],
  p_shown_place_ids uuid[]
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.ai_guide_traces (
    trace_id, mode, prompt_version, model_name, latency_ms, fallback_reason,
    validation_result, candidate_place_ids, shown_place_ids
  ) values (
    p_trace_id, p_mode, p_prompt_version, p_model_name,
    greatest(0, coalesce(p_latency_ms, 0)), p_fallback_reason,
    coalesce(p_validation_result, '{}'::jsonb),
    coalesce(p_candidate_place_ids, '{}'), coalesce(p_shown_place_ids, '{}')
  );
$$;

-- ---------------------------------------------------------------------------
-- Catalogue request submission and result notifications
-- ---------------------------------------------------------------------------

create or replace function public.m6_request_catalogue_place(p_requested_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_requested_name, ''), '\s+', ' ', 'g'));
  v_normalized text;
  v_id uuid;
  v_support integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'Place name must contain 2 to 160 characters';
  end if;
  v_normalized := lower(v_name);

  insert into public.place_catalogue_requests (requester_id, requested_name, normalized_name)
  values (v_user_id, v_name, v_normalized)
  on conflict (requester_id, normalized_name) do update set updated_at = now()
  returning id into v_id;

  select count(*)::integer into v_support
  from public.place_catalogue_requests
  where normalized_name = v_normalized and status in ('pending', 'processing', 'accepted');

  update public.place_catalogue_requests
  set support_count = greatest(1, v_support), updated_at = now()
  where normalized_name = v_normalized;
  return v_id;
end;
$$;

create or replace function private.notify_m6_catalogue_request_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_body text;
begin
  if new.status is not distinct from old.status or new.status not in ('accepted', 'rejected') then
    return new;
  end if;
  if new.status = 'accepted' then
    v_title := 'Your destination request was added';
    v_body := new.requested_name || ' passed catalogue verification and is now available.';
  else
    v_title := 'Destination request update';
    v_body := new.requested_name || ' could not be added (' || replace(new.rejection_reason, '_', ' ') || ').';
  end if;
  perform private.create_user_notification(
    new.requester_id, 'm6', 'catalogue_request_' || new.status,
    v_title, v_body,
    case when new.resolved_place_id is null then '/assistant' else '/discover/' || new.resolved_place_id::text end,
    jsonb_build_object('requestId', new.id, 'status', new.status, 'placeId', new.resolved_place_id),
    'm6:catalogue:' || new.id::text || ':' || new.status
  );
  return new;
end;
$$;

drop trigger if exists notify_m6_catalogue_request_result on public.place_catalogue_requests;
create trigger notify_m6_catalogue_request_result
after update of status on public.place_catalogue_requests
for each row execute function private.notify_m6_catalogue_request_result();

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

create or replace function private.prune_m6_tumpang_guide()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.ai_guide_sessions where expires_at <= now();
  get diagnostics v_count = row_count;
  delete from private.ai_guide_traces where session_id is null and created_at < now() - interval '90 days';
  delete from private.ai_guide_usage where usage_date < current_date - 90;
  return v_count;
end;
$$;

-- Reuses the existing m6-ingest URL/key Vault entries created for 042. The
-- function itself performs one Text Search and one bounded Details enrichment
-- per selected aggregate, never more than five names per weekly run.
create or replace function private.run_m6_guide_catalogue_requests()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'm6_ingest_function_url';
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'm6_ingest_secret_key';
  if v_url is null or v_key is null then
    raise exception 'Module 6 ingestion Vault secrets are missing - see docs/TUMPANG-GUIDE.md';
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('apikey', v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('catalogueRequests', true, 'maxCatalogueRequests', 5)
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.m6_guide_check_quota(text, uuid, integer, integer, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.m6_match_ai_help(text, extensions.vector, integer)
  from public, anon, authenticated;
revoke all on function public.m6_guide_record_success(text, text)
  from public, anon, authenticated;
revoke all on function public.m6_guide_persist_turn(uuid, uuid, text, jsonb, text, jsonb, jsonb, text, text, text, integer, text, jsonb, uuid[])
  from public, anon, authenticated;
revoke all on function public.m6_guide_save_feedback(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.m6_guide_record_guest_trace(text, text, text, text, integer, text, jsonb, uuid[], uuid[])
  from public, anon, authenticated;
revoke all on function public.m6_request_catalogue_place(text)
  from public, anon, authenticated;
revoke all on function private.notify_m6_catalogue_request_result()
  from public, anon, authenticated;
revoke all on function private.prune_m6_tumpang_guide()
  from public, anon, authenticated;
revoke all on function private.run_m6_guide_catalogue_requests()
  from public, anon, authenticated;

grant execute on function public.m6_guide_check_quota(text, uuid, integer, integer, text, integer, integer)
  to service_role;
grant execute on function public.m6_match_ai_help(text, extensions.vector, integer)
  to service_role;
grant execute on function public.m6_guide_record_success(text, text)
  to service_role;
grant execute on function public.m6_guide_persist_turn(uuid, uuid, text, jsonb, text, jsonb, jsonb, text, text, text, integer, text, jsonb, uuid[])
  to service_role;
grant execute on function public.m6_guide_save_feedback(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.m6_guide_record_guest_trace(text, text, text, text, integer, text, jsonb, uuid[], uuid[])
  to service_role;
grant execute on function public.m6_request_catalogue_place(text)
  to authenticated;

-- Restore the private schema usage expected by existing RLS helpers after the
-- defensive schema revoke near the top of this migration.
grant usage on schema private to anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'm6-tumpang-guide-retention'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'm6-tumpang-guide-retention',
    '43 3 * * *',
    'select private.prune_m6_tumpang_guide();'
  );

  for v_job_id in select jobid from cron.job where jobname = 'm6-guide-catalogue-requests'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'm6-guide-catalogue-requests',
    '29 3 * * 2',
    'select private.run_m6_guide_catalogue_requests();'
  );
end;
$$;
