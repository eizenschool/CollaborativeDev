-- Module 1 privacy-controlled public profile projection.
-- Deployed through the Dashboard SQL Editor; see docs/ai/SQL.md.
-- Depends on profiles.spoken_languages from 039 and the reputation helper from 072.

create table if not exists public.profile_visibility (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  show_profile_photo boolean not null default true,
  show_spoken_languages boolean not null default true,
  show_completed_trips boolean not null default true,
  show_eco_impact boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.profile_visibility
  add column if not exists show_profile_photo boolean not null default true,
  add column if not exists show_spoken_languages boolean not null default true,
  add column if not exists show_completed_trips boolean not null default true,
  add column if not exists show_eco_impact boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

insert into public.profile_visibility (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

alter table public.profile_visibility enable row level security;

drop policy if exists "users read their own profile visibility" on public.profile_visibility;
drop policy if exists "users insert their own profile visibility" on public.profile_visibility;
drop policy if exists "users update their own profile visibility" on public.profile_visibility;

create policy "users read their own profile visibility"
  on public.profile_visibility for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "users insert their own profile visibility"
  on public.profile_visibility for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "users update their own profile visibility"
  on public.profile_visibility for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.profile_visibility from public, anon, authenticated;
grant select, insert on table public.profile_visibility to authenticated;
grant update (show_profile_photo, show_spoken_languages, show_completed_trips, show_eco_impact, updated_at)
  on table public.profile_visibility to authenticated;

-- Raw cross-profile reads are limited to active published Drivers and actual
-- Ride parties. Everyone else uses the privacy-filtered public RPC below.
-- The helper avoids recursive profiles <-> rides RLS evaluation.
create or replace function private.profile_is_relevant_to_viewer(
  p_profile_id uuid,
  p_viewer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = p_viewer_id
    or exists (
      select 1 from public.rides r
      where r.host_id = p_profile_id and r.status = 'Published'
    )
    or (
      p_viewer_id is not null
      and exists (
        select 1
        from public.ride_requests rr
        join public.rides r on r.id = rr.ride_id
        where (rr.requester_id = p_profile_id and r.host_id = p_viewer_id)
           or (r.host_id = p_profile_id and rr.requester_id = p_viewer_id)
      )
    );
$$;

revoke all on function private.profile_is_relevant_to_viewer(uuid, uuid)
  from public, anon, authenticated;

drop policy if exists "anonymous users read active public profiles" on public.profiles;
drop policy if exists "anonymous users read active published drivers" on public.profiles;
drop policy if exists "authenticated users read safe profiles" on public.profiles;
drop policy if exists "authenticated users read relevant profiles" on public.profiles;

create policy "anonymous users read active published drivers"
  on public.profiles for select to anon
  using (
    status = 'active'
    and private.profile_is_relevant_to_viewer(id, null)
  );
create policy "authenticated users read relevant profiles"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (
      status = 'active'
      and private.profile_is_relevant_to_viewer(id, (select auth.uid()))
    )
  );

create or replace function private.create_profile_visibility_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profile_visibility (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.create_profile_visibility_defaults()
  from public, anon, authenticated;
drop trigger if exists create_profile_visibility_after_profile on public.profiles;
create trigger create_profile_visibility_after_profile
after insert on public.profiles
for each row execute function private.create_profile_visibility_defaults();

create or replace function public.get_public_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_stats public.host_impact_stats%rowtype;
  v_visibility public.profile_visibility%rowtype;
  v_parts text[];
  v_display_name text;
  v_review_count integer := 0;
  v_evidence_count integer := 0;
begin
  select * into v_profile
  from public.profiles
  where id = p_user_id and status = 'active';
  if not found then return null; end if;

  select * into v_stats
  from public.host_impact_stats
  where user_id = p_user_id;

  select * into v_visibility
  from public.profile_visibility
  where user_id = p_user_id;
  if not found then
    v_visibility.show_profile_photo := true;
    v_visibility.show_spoken_languages := true;
    v_visibility.show_completed_trips := true;
    v_visibility.show_eco_impact := false;
  end if;

  v_parts := regexp_split_to_array(btrim(v_profile.full_name), '\s+');
  if coalesce(array_length(v_parts, 1), 0) < 2 then
    v_display_name := coalesce(v_parts[1], 'Member');
  else
    v_display_name := v_parts[1] || ' '
      || upper(left(v_parts[array_length(v_parts, 1)], 1)) || '.';
  end if;

  select count(*)::integer into v_review_count
  from public.ride_reviews
  where reviewee_id = p_user_id;
  v_evidence_count := private.reputation_evidence_count(p_user_id);

  return jsonb_build_object(
    'id', v_profile.id,
    'displayName', v_display_name,
    'profilePhotoUrl', case
      when v_visibility.show_profile_photo then v_profile.profile_photo_url
      else null
    end,
    'spokenLanguages', case
      when v_visibility.show_spoken_languages then to_jsonb(v_profile.spoken_languages)
      else '[]'::jsonb
    end,
    'createdAt', v_profile.created_at,
    'reputationScore', coalesce(v_stats.reputation_score, 70),
    'rating', v_stats.rating,
    'reviewCount', v_review_count,
    'completedTrips', case
      when v_visibility.show_completed_trips then coalesce(v_stats.completed_trips, 0)
      else null
    end,
    'co2SavedKg', case
      when v_visibility.show_eco_impact then coalesce(v_stats.co2_saved_kg, 0)
      else null
    end,
    'provisional', v_evidence_count < 3,
    'visibility', jsonb_build_object(
      'showProfilePhoto', v_visibility.show_profile_photo,
      'showSpokenLanguages', v_visibility.show_spoken_languages,
      'showCompletedTrips', v_visibility.show_completed_trips,
      'showEcoImpact', v_visibility.show_eco_impact
    )
  );
end;
$$;

revoke all on function public.get_public_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.get_public_profile(uuid)
  to anon, authenticated;
