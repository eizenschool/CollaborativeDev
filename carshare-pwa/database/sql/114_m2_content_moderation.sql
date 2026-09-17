-- Authored only. Deploy after provider evaluation and coordinated Edge release.
begin;

create table public.m2_moderated_photos (
  path text primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  policy_version text not null,
  retiring boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.m2_content_approvals (
  id uuid primary key default extensions.gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  contribution_digest text not null check (contribution_digest ~ '^[a-f0-9]{64}$'),
  instructions_digest text not null check (instructions_digest ~ '^[a-f0-9]{64}$'),
  photo_path text,
  base_updated_at timestamptz not null,
  policy_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);
create index m2_content_approvals_ride on public.m2_content_approvals(ride_id, host_id, created_at desc);
alter table public.m2_moderated_photos enable row level security;
alter table public.m2_content_approvals enable row level security;
revoke all on public.m2_moderated_photos, public.m2_content_approvals from public, anon, authenticated;
grant all on public.m2_moderated_photos, public.m2_content_approvals to service_role;
alter table public.rides add column content_approval_id uuid;
-- The column deliberately has no browser UPDATE grant.

-- Restrictive policies also close any pre-existing permissive upload policy.
create policy "M2 pickup uploads only through moderation" on storage.objects as restrictive
  for insert to anon, authenticated with check (bucket_id <> 'ride-pickup-photos');
create policy "M2 pickup objects immutable to browsers" on storage.objects as restrictive
  for update to anon, authenticated using (bucket_id <> 'ride-pickup-photos') with check (bucket_id <> 'ride-pickup-photos');
create policy "M2 pickup removal through server" on storage.objects as restrictive
  for delete to anon, authenticated using (bucket_id <> 'ride-pickup-photos');

create function private.m2_assert_content_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.rides%rowtype; a public.m2_content_approvals%rowtype; needs_check boolean;
begin
  -- Deferred: inspect the final row after the atomic photo + route update.
  select * into r from public.rides where id = new.id;
  if not found then return null; end if;
  if tg_op = 'INSERT' then needs_check := r.status = 'Published';
  else
    needs_check := r.status = 'Published' and (
      old.status = 'Draft' or
      row(old.vehicle_id,old.pickup,old.destination,old.departure_at,old.journey_scale,
          old.seats_total,old.contribution,old.pickup_instructions,old.pickup_photo_path,
          old.restriction_tags,old.waypoints,old.route_quote_id,old.content_approval_id)
      is distinct from
      row(new.vehicle_id,new.pickup,new.destination,new.departure_at,new.journey_scale,
          new.seats_total,new.contribution,new.pickup_instructions,new.pickup_photo_path,
          new.restriction_tags,new.waypoints,new.route_quote_id,new.content_approval_id));
  end if;
  if not needs_check then return null; end if;
  select * into a from public.m2_content_approvals where id = r.content_approval_id;
  if not found or a.ride_id <> r.id or a.host_id <> r.host_id
     or a.policy_version <> 'm2-content-v4' or a.expires_at <= now()
     or a.contribution_digest <> encode(extensions.digest(coalesce(r.contribution,''),'sha256'),'hex')
     or a.instructions_digest <> encode(extensions.digest(coalesce(r.pickup_instructions,''),'sha256'),'hex')
     or a.photo_path is distinct from r.pickup_photo_path then
    raise exception 'CONTENT_APPROVAL_REQUIRED: Review the content and try again';
  end if;
  if r.pickup_photo_path is not null and not exists (
    select 1 from public.m2_moderated_photos p join storage.objects o
      on o.bucket_id='ride-pickup-photos' and o.name=p.path
    where p.path=r.pickup_photo_path and p.ride_id=r.id and p.host_id=r.host_id
      and p.policy_version='m2-content-v4' and not p.retiring
  ) then raise exception 'PHOTO_APPROVAL_REQUIRED'; end if;
  return null;
end;
$$;
revoke all on function private.m2_assert_content_approval() from public, anon, authenticated;
create constraint trigger m2_content_approval_guard after insert or update on public.rides
  deferrable initially deferred for each row execute function private.m2_assert_content_approval();

-- Draft photo binding only. Published photos change in persist_moderated_ride.
create function public.bind_m2_draft_photo(p_host_id uuid, p_ride_id uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rides%rowtype;
begin
  select * into r from public.rides where id=p_ride_id for update;
  if not found or r.host_id<>p_host_id or r.status<>'Draft'
    or exists(select 1 from public.ride_requests where ride_id=r.id and status='Accepted') then
    raise exception 'This Draft can no longer be edited';
  end if;
  if p_path is not null and not exists(select 1 from public.m2_moderated_photos
    where path=p_path and ride_id=r.id and host_id=r.host_id and policy_version='m2-content-v4' and not retiring) then
    raise exception 'PHOTO_APPROVAL_REQUIRED';
  end if;
  update public.rides set pickup_photo_path=p_path, updated_at=now() where id=r.id;
end;
$$;
revoke all on function public.bind_m2_draft_photo(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bind_m2_draft_photo(uuid,uuid,text) to service_role;
revoke all on function public.set_ride_pickup_photo(uuid,text) from public,anon,authenticated;

create table public.m2_content_rate_limits (
  host_id uuid not null references public.profiles(id) on delete cascade,
  hour timestamptz not null, attempts integer not null, primary key(host_id,hour)
);
alter table public.m2_content_rate_limits enable row level security;
revoke all on public.m2_content_rate_limits from public,anon,authenticated;
grant all on public.m2_content_rate_limits to service_role;
create function public.consume_m2_content_quota(p_host_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.m2_content_rate_limits values(p_host_id,date_trunc('hour',now()),1)
  on conflict(host_id,hour) do update set attempts=m2_content_rate_limits.attempts+1
  returning attempts into n;
  if n>20 then raise exception 'CONTENT_CHECK_RATE_LIMIT'; end if;
  delete from public.m2_content_rate_limits where hour < now()-interval '2 days';
end;
$$;
revoke all on function public.consume_m2_content_quota(uuid) from public,anon,authenticated;
grant execute on function public.consume_m2_content_quota(uuid) to service_role;

-- Atomic persistence wrapper is appended below before COMMIT.

create function public.persist_moderated_ride(p_args jsonb, p_approval_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.rides%rowtype; a public.m2_content_approvals%rowtype; result uuid;
begin
  select * into r from public.rides where id=(p_args->>'p_ride_id')::uuid for update;
  if not found then raise exception 'Draft or Ride required'; end if;
  select * into a from public.m2_content_approvals where id=p_approval_id;
  if not found or a.ride_id<>r.id or a.host_id<>r.host_id
    or a.host_id<>(p_args->>'p_host_id')::uuid
    or a.base_updated_at is distinct from r.updated_at
    or a.expires_at<=now() or a.policy_version<>'m2-content-v4' then
    raise exception 'CONTENT_APPROVAL_STALE: Ride changed; review and retry';
  end if;
  if p_args->>'p_mode' not in ('update','publish_draft') then raise exception 'Draft required'; end if;
  update public.rides set pickup_photo_path=a.photo_path, content_approval_id=a.id where id=r.id;
  result := public.persist_quoted_ride(
    p_host_id => (p_args->>'p_host_id')::uuid,
    p_mode => (p_args->>'p_mode')::text,
    p_ride_id => (p_args->>'p_ride_id')::uuid,
    p_vehicle_id => (p_args->>'p_vehicle_id')::uuid,
    p_pickup => (p_args->>'p_pickup')::text,
    p_destination => (p_args->>'p_destination')::text,
    p_departure_at => (p_args->>'p_departure_at')::timestamptz,
    p_journey_scale => (p_args->>'p_journey_scale')::text,
    p_seats_total => (p_args->>'p_seats_total')::integer,
    p_pickup_place_id => (p_args->>'p_pickup_place_id')::text,
    p_pickup_latitude => (p_args->>'p_pickup_latitude')::double precision,
    p_pickup_longitude => (p_args->>'p_pickup_longitude')::double precision,
    p_destination_place_id => (p_args->>'p_destination_place_id')::text,
    p_pickup_instructions => (p_args->>'p_pickup_instructions')::text,
    p_contribution => (p_args->>'p_contribution')::text,
    p_restriction_tags => array(select jsonb_array_elements_text(p_args->'p_restriction_tags')),
    p_waypoints => p_args->'p_waypoints',
    p_route_quote_id => (p_args->>'p_route_quote_id')::uuid,
    p_route_quoted_at => (p_args->>'p_route_quoted_at')::timestamptz,
    p_route_quote_expires_at => (p_args->>'p_route_quote_expires_at')::timestamptz,
    p_route_distance_meters => (p_args->>'p_route_distance_meters')::integer,
    p_route_duration_seconds => (p_args->>'p_route_duration_seconds')::integer,
    p_route_stopover_seconds => (p_args->>'p_route_stopover_seconds')::integer,
    p_estimated_arrival_at => (p_args->>'p_estimated_arrival_at')::timestamptz,
    p_pickup_anchor_latitude => (p_args->>'p_pickup_anchor_latitude')::double precision,
    p_pickup_anchor_longitude => (p_args->>'p_pickup_anchor_longitude')::double precision,
    p_destination_anchor_latitude => (p_args->>'p_destination_anchor_latitude')::double precision,
    p_destination_anchor_longitude => (p_args->>'p_destination_anchor_longitude')::double precision
  );
  return result;
end;
$$;
revoke all on function public.persist_moderated_ride(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.persist_moderated_ride(jsonb,uuid) to service_role;

-- Claim old unbound assets before deleting through the Storage API (never delete
-- storage.objects metadata directly). Live receipts prevent cleanup/publish races.
create function public.claim_m2_unused_photos() returns table(path text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.m2_moderated_photos p set retiring=true
  where p.created_at < now()-interval '24 hours'
    and not exists(select 1 from public.rides r where r.pickup_photo_path=p.path)
    and not exists(select 1 from public.m2_content_approvals a where a.photo_path=p.path and a.expires_at>now())
  returning p.path;
  -- Also recover uploads interrupted before the asset row could be written.
  return query select o.name from storage.objects o
    where o.bucket_id='ride-pickup-photos' and o.created_at<now()-interval '24 hours'
    and not exists(select 1 from public.m2_moderated_photos p where p.path=o.name)
    and not exists(select 1 from public.rides r where r.pickup_photo_path=o.name)
    and not exists(select 1 from public.m2_content_approvals a where a.photo_path=o.name and a.expires_at>now());
  delete from public.m2_content_approvals where expires_at < now()-interval '1 day';
end;
$$;
revoke all on function public.claim_m2_unused_photos() from public,anon,authenticated;
grant execute on function public.claim_m2_unused_photos() to service_role;
commit;
