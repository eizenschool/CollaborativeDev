-- Module 1 security hardening for the initial Supabase connection.
-- Keeps public profile data separate from private account data and replaces
-- the original sign-up trigger with a search_path-safe implementation.

create table public.profile_private (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null default '',
  emergency_contact jsonb not null
    default '{"name":"","phone":"","relationship":""}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profile_private (user_id, phone, emergency_contact)
select id, coalesce(phone, ''), emergency_contact
from public.profiles
on conflict (user_id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, profile_photo_url)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'New member'
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  );

  insert into public.profile_private (user_id, phone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'phone', ''));

  insert into public.host_impact_stats (user_id)
  values (new.id);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

alter table public.profiles
  drop column email,
  drop column phone,
  drop column emergency_contact;

alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.host_impact_stats enable row level security;

drop policy if exists "profiles are publicly readable" on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;
drop policy if exists "users can delete their own profile" on public.profiles;
drop policy if exists "impact stats are publicly readable" on public.host_impact_stats;

create policy "authenticated users read safe profiles"
  on public.profiles for select to authenticated
  using (true);

create policy "users update their own safe profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "users read their own private profile"
  on public.profile_private for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users update their own private profile"
  on public.profile_private for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "authenticated users read impact stats"
  on public.host_impact_stats for select to authenticated
  using (true);

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.profile_private from public, anon, authenticated;
revoke all on table public.host_impact_stats from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (full_name, profile_photo_url, status) on table public.profiles to authenticated;
grant select on table public.profile_private to authenticated;
grant update (phone, emergency_contact, updated_at) on table public.profile_private to authenticated;
grant select on table public.host_impact_stats to authenticated;
