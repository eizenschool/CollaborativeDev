-- Module 2 authoritative departure time, ride lifecycle metadata, secure ride
-- mutations, and multi-seat ride requests.

alter table public.rides
  add column departure_at timestamptz,
  add column published_at timestamptz,
  add column recruitment_closed_at timestamptz,
  add column cancel_reason text,
  add column expired_at timestamptz,
  add column updated_at timestamptz not null default now();

update public.rides
set departure_at = ((date::text || ' ' || time)::timestamp at time zone 'Asia/Kuala_Lumpur'),
    published_at = case
      when status <> 'Draft' then created_at
      else null
    end,
    updated_at = created_at;

alter table public.rides
  alter column departure_at set not null,
  drop constraint rides_status_check,
  add constraint rides_status_check check (
    status in ('Draft', 'Published', 'Matched', 'In Transit', 'Completed', 'Cancelled', 'Expired')
  ),
  add constraint rides_cancel_reason_check check (
    status <> 'Cancelled' or nullif(btrim(cancel_reason), '') is not null
  );

drop index if exists public.rides_status_date_idx;
alter table public.rides drop column date, drop column time;

create index rides_status_departure_at_idx
  on public.rides (status, departure_at);
create index rides_host_status_departure_at_idx
  on public.rides (host_id, status, departure_at desc);

create or replace function public.set_rides_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_rides_updated_at() from public, anon, authenticated;

create trigger set_rides_updated_at
before update on public.rides
for each row execute function public.set_rides_updated_at();

create table public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  seats_requested integer not null check (seats_requested between 1 and 8),
  companion_names text[] not null default '{}',
  status text not null default 'Pending' check (
    status in ('Pending', 'Accepted', 'Rejected', 'Cancelled', 'Expired')
  ),
  decision_reason text,
  cancelled_by text check (cancelled_by in ('Requester', 'Host', 'System')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  cancelled_at timestamptz,
  constraint ride_requests_companion_count_check check (
    cardinality(companion_names) = seats_requested - 1
  ),
  constraint ride_requests_companion_names_check check (
    array_position(companion_names, null) is null
  )
);

create unique index ride_requests_one_active_per_requester_idx
  on public.ride_requests (ride_id, requester_id)
  where status in ('Pending', 'Accepted');
create index ride_requests_ride_status_created_idx
  on public.ride_requests (ride_id, status, created_at);
create index ride_requests_requester_created_idx
  on public.ride_requests (requester_id, created_at desc);
create index ride_requests_pending_ride_idx
  on public.ride_requests (ride_id)
  where status = 'Pending';

create or replace function public.set_ride_requests_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_ride_requests_updated_at() from public, anon, authenticated;

create trigger set_ride_requests_updated_at
before update on public.ride_requests
for each row execute function public.set_ride_requests_updated_at();

alter table public.ride_requests enable row level security;

create or replace function public.is_ride_host(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rides r
    where r.id = p_ride_id
      and r.host_id = auth.uid()
  );
$$;

create or replace function public.is_accepted_ride_requester(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ride_requests rr
    where rr.ride_id = p_ride_id
      and rr.requester_id = auth.uid()
      and rr.status = 'Accepted'
  );
$$;

revoke all on function public.is_ride_host(uuid) from public, anon, authenticated;
revoke all on function public.is_accepted_ride_requester(uuid) from public, anon, authenticated;
grant execute on function public.is_ride_host(uuid) to authenticated;
grant execute on function public.is_accepted_ride_requester(uuid) to authenticated;

drop policy if exists "authenticated users browse active published rides" on public.rides;
drop policy if exists "hosts create their own rides" on public.rides;
drop policy if exists "hosts update their own rides" on public.rides;
drop policy if exists "hosts delete their own rides" on public.rides;

create policy "authenticated users read allowed rides"
  on public.rides for select to authenticated
  using (
    (select auth.uid()) = host_id
    or public.is_accepted_ride_requester(id)
    or (
      status = 'Published'
      and exists (
        select 1
        from public.profiles
        where profiles.id = rides.host_id
          and profiles.status = 'active'
      )
    )
  );

create policy "request participants read requests"
  on public.ride_requests for select to authenticated
  using (
    requester_id = (select auth.uid())
    or public.is_ride_host(ride_id)
  );

revoke all on table public.rides from public, anon, authenticated;
grant select on table public.rides to authenticated;

revoke all on table public.ride_requests from public, anon, authenticated;
grant select on table public.ride_requests to authenticated;

create or replace function public.create_ride(
  p_vehicle_id uuid,
  p_pickup text,
  p_destination text,
  p_departure_at timestamptz,
  p_journey_scale text,
  p_seats_total integer,
  p_contribution text default '',
  p_restriction_tags text[] default '{}',
  p_waypoints jsonb default '[]'::jsonb,
  p_publish boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_vehicle_seats integer;
  v_ride_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(p_pickup), '') is null
     or nullif(btrim(p_destination), '') is null
     or p_departure_at is null
     or p_journey_scale not in ('Urban', 'Intercity')
     or p_seats_total is null
     or p_seats_total < 1 then
    raise exception 'Complete ride details are required';
  end if;

  if jsonb_typeof(p_waypoints) <> 'array' then
    raise exception 'Waypoints must be an array';
  end if;

  select v.seats
  into v_vehicle_seats
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.owner_id = v_user_id;

  if v_vehicle_seats is null then
    raise exception 'Select a vehicle you own';
  end if;

  if p_seats_total > v_vehicle_seats then
    raise exception 'Available seats exceed vehicle capacity';
  end if;

  if p_publish and p_departure_at < now() + interval '5 hours' then
    raise exception 'Published rides must depart at least 5 hours from now';
  end if;

  insert into public.rides (
    host_id, vehicle_id, pickup, destination, departure_at, journey_scale,
    seats_total, seats_available, contribution, restriction_tags, status,
    waypoints, published_at
  ) values (
    v_user_id, p_vehicle_id, btrim(p_pickup), btrim(p_destination), p_departure_at,
    p_journey_scale, p_seats_total, p_seats_total, coalesce(p_contribution, ''),
    coalesce(p_restriction_tags, '{}'),
    case when p_publish then 'Published' else 'Draft' end,
    p_waypoints,
    case when p_publish then now() else null end
  )
  returning id into v_ride_id;

  return v_ride_id;
end;
$$;

create or replace function public.update_ride(
  p_ride_id uuid,
  p_vehicle_id uuid,
  p_pickup text,
  p_destination text,
  p_departure_at timestamptz,
  p_journey_scale text,
  p_seats_total integer,
  p_contribution text default '',
  p_restriction_tags text[] default '{}',
  p_waypoints jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_vehicle_seats integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found or v_ride.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;

  if v_ride.status not in ('Draft', 'Published') then
    raise exception 'Only Draft or Published rides can be edited';
  end if;

  if exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id and status = 'Accepted'
  ) then
    raise exception 'A ride with accepted requests cannot be edited';
  end if;

  if nullif(btrim(p_pickup), '') is null
     or nullif(btrim(p_destination), '') is null
     or p_departure_at is null
     or p_journey_scale not in ('Urban', 'Intercity')
     or p_seats_total is null
     or p_seats_total < 1 then
    raise exception 'Complete ride details are required';
  end if;

  if jsonb_typeof(p_waypoints) <> 'array' then
    raise exception 'Waypoints must be an array';
  end if;

  select v.seats into v_vehicle_seats
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.owner_id = v_user_id;

  if v_vehicle_seats is null then
    raise exception 'Select a vehicle you own';
  end if;

  if p_seats_total > v_vehicle_seats then
    raise exception 'Available seats exceed vehicle capacity';
  end if;

  if v_ride.status = 'Published' and p_departure_at < now() + interval '5 hours' then
    raise exception 'Published rides must depart at least 5 hours from now';
  end if;

  update public.rides
  set vehicle_id = p_vehicle_id,
      pickup = btrim(p_pickup),
      destination = btrim(p_destination),
      departure_at = p_departure_at,
      journey_scale = p_journey_scale,
      seats_total = p_seats_total,
      seats_available = p_seats_total,
      contribution = coalesce(p_contribution, ''),
      restriction_tags = coalesce(p_restriction_tags, '{}'),
      waypoints = p_waypoints
  where id = p_ride_id;

  return p_ride_id;
end;
$$;

create or replace function public.publish_ride(p_ride_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;

  if v_user_id is null or not found or v_ride.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;
  if v_ride.status <> 'Draft' then
    raise exception 'Only Draft rides can be published';
  end if;
  if v_ride.departure_at < now() + interval '5 hours' then
    raise exception 'Published rides must depart at least 5 hours from now';
  end if;

  update public.rides
  set status = 'Published', published_at = now()
  where id = p_ride_id;

  return p_ride_id;
end;
$$;

create or replace function public.delete_draft_ride(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  delete from public.rides
  where id = p_ride_id
    and host_id = auth.uid()
    and status = 'Draft';

  if not found then
    raise exception 'Only your Draft rides can be deleted';
  end if;
end;
$$;

create or replace function public.cancel_ride(p_ride_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A cancellation reason is required';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_user_id is null or not found or v_ride.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;
  if v_ride.status not in ('Published', 'Matched') then
    raise exception 'Only Published or Matched rides can be cancelled';
  end if;

  update public.ride_requests
  set status = 'Cancelled',
      decision_reason = btrim(p_reason),
      cancelled_by = 'Host',
      cancelled_at = now(),
      processed_at = coalesce(processed_at, now())
  where ride_id = p_ride_id
    and status in ('Pending', 'Accepted');

  update public.rides
  set status = 'Cancelled',
      cancel_reason = btrim(p_reason),
      seats_available = seats_total,
      recruitment_closed_at = coalesce(recruitment_closed_at, now())
  where id = p_ride_id;

  return p_ride_id;
end;
$$;

create or replace function public.close_ride_recruitment(p_ride_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_user_id is null or not found or v_ride.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;
  if v_ride.status <> 'Published' or v_ride.departure_at <= now() then
    raise exception 'Only an upcoming Published ride can close recruitment';
  end if;

  update public.ride_requests
  set status = 'Expired',
      decision_reason = 'Recruitment closed',
      cancelled_by = 'System',
      processed_at = now()
  where ride_id = p_ride_id and status = 'Pending';

  update public.rides
  set status = 'Matched', recruitment_closed_at = now()
  where id = p_ride_id;

  return p_ride_id;
end;
$$;

create or replace function public.reopen_ride_recruitment(p_ride_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_user_id is null or not found or v_ride.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;
  if v_ride.status <> 'Matched' then
    raise exception 'Only Matched rides can reopen recruitment';
  end if;
  if now() >= v_ride.departure_at - interval '5 hours' then
    raise exception 'Recruitment can no longer be reopened';
  end if;

  update public.rides
  set status = 'Published', recruitment_closed_at = null
  where id = p_ride_id;

  return p_ride_id;
end;
$$;

create or replace function public.submit_ride_request(
  p_ride_id uuid,
  p_seats_requested integer,
  p_companion_names text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_request_id uuid;
  v_clean_names text[];
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_seats_requested is null or p_seats_requested < 1 or p_seats_requested > 8 then
    raise exception 'Seats requested must be between 1 and 8';
  end if;

  select coalesce(array_agg(btrim(name) order by ordinal), '{}')
  into v_clean_names
  from unnest(coalesce(p_companion_names, '{}')) with ordinality as names(name, ordinal);

  if cardinality(v_clean_names) <> p_seats_requested - 1
     or exists (select 1 from unnest(v_clean_names) as n(name) where nullif(name, '') is null) then
    raise exception 'Provide one companion name for each additional seat';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'Ride not found';
  end if;
  if v_ride.host_id = v_user_id then
    raise exception 'Hosts cannot request their own ride';
  end if;
  if v_ride.status <> 'Published' then
    raise exception 'This ride is not accepting requests';
  end if;
  if now() >= v_ride.departure_at - interval '5 hours' then
    raise exception 'The request deadline has passed';
  end if;
  if p_seats_requested > v_ride.seats_available then
    raise exception 'Not enough seats are currently available';
  end if;
  if exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id
      and requester_id = v_user_id
      and status = 'Rejected'
  ) then
    raise exception 'A rejected request cannot be submitted again';
  end if;
  if exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id
      and requester_id = v_user_id
      and status in ('Pending', 'Accepted')
  ) then
    raise exception 'You already have an active request for this ride';
  end if;

  insert into public.ride_requests (
    ride_id, requester_id, seats_requested, companion_names
  ) values (
    p_ride_id, v_user_id, p_seats_requested, v_clean_names
  ) returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.respond_to_ride_request(
  p_request_id uuid,
  p_decision text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride_id uuid;
  v_ride public.rides%rowtype;
  v_request public.ride_requests%rowtype;
begin
  if p_decision not in ('Accepted', 'Rejected') then
    raise exception 'Decision must be Accepted or Rejected';
  end if;
  if p_decision = 'Rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A rejection reason is required';
  end if;

  select ride_id into v_ride_id from public.ride_requests where id = p_request_id;
  if not found then
    raise exception 'Ride request not found';
  end if;

  select * into v_ride from public.rides where id = v_ride_id for update;
  select * into v_request from public.ride_requests where id = p_request_id for update;

  if v_user_id is null or v_ride.host_id <> v_user_id then
    raise exception 'Only the ride Host can process requests';
  end if;
  if v_ride.status <> 'Published' or v_ride.departure_at <= now() then
    raise exception 'This ride can no longer process requests';
  end if;
  if v_request.status <> 'Pending' then
    raise exception 'This request has already been processed';
  end if;

  if p_decision = 'Accepted' then
    if v_request.seats_requested > v_ride.seats_available then
      raise exception 'Not enough seats remain for this request';
    end if;

    update public.rides
    set seats_available = seats_available - v_request.seats_requested
    where id = v_ride_id;
  end if;

  update public.ride_requests
  set status = p_decision,
      decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      processed_at = now()
  where id = p_request_id;

  return p_request_id;
end;
$$;

create or replace function public.cancel_ride_request(
  p_request_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride_id uuid;
  v_ride public.rides%rowtype;
  v_request public.ride_requests%rowtype;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A cancellation reason is required';
  end if;

  select ride_id into v_ride_id from public.ride_requests where id = p_request_id;
  if not found then
    raise exception 'Ride request not found';
  end if;

  select * into v_ride from public.rides where id = v_ride_id for update;
  select * into v_request from public.ride_requests where id = p_request_id for update;

  if v_user_id is null or v_request.requester_id <> v_user_id then
    raise exception 'Only the requester can cancel this request';
  end if;
  if v_request.status not in ('Pending', 'Accepted') then
    raise exception 'Only an active request can be cancelled';
  end if;
  if v_ride.status = 'In Transit' or v_ride.status = 'Completed' or v_ride.departure_at <= now() then
    raise exception 'This request can no longer be cancelled';
  end if;

  if v_request.status = 'Accepted' then
    update public.rides
    set seats_available = least(seats_total, seats_available + v_request.seats_requested)
    where id = v_ride_id;
  end if;

  update public.ride_requests
  set status = 'Cancelled',
      decision_reason = btrim(p_reason),
      cancelled_by = 'Requester',
      cancelled_at = now(),
      processed_at = coalesce(processed_at, now())
  where id = p_request_id;

  return p_request_id;
end;
$$;

revoke all on function public.create_ride(uuid, text, text, timestamptz, text, integer, text, text[], jsonb, boolean) from public, anon, authenticated;
revoke all on function public.update_ride(uuid, uuid, text, text, timestamptz, text, integer, text, text[], jsonb) from public, anon, authenticated;
revoke all on function public.publish_ride(uuid) from public, anon, authenticated;
revoke all on function public.delete_draft_ride(uuid) from public, anon, authenticated;
revoke all on function public.cancel_ride(uuid, text) from public, anon, authenticated;
revoke all on function public.close_ride_recruitment(uuid) from public, anon, authenticated;
revoke all on function public.reopen_ride_recruitment(uuid) from public, anon, authenticated;
revoke all on function public.submit_ride_request(uuid, integer, text[]) from public, anon, authenticated;
revoke all on function public.respond_to_ride_request(uuid, text, text) from public, anon, authenticated;
revoke all on function public.cancel_ride_request(uuid, text) from public, anon, authenticated;

grant execute on function public.create_ride(uuid, text, text, timestamptz, text, integer, text, text[], jsonb, boolean) to authenticated;
grant execute on function public.update_ride(uuid, uuid, text, text, timestamptz, text, integer, text, text[], jsonb) to authenticated;
grant execute on function public.publish_ride(uuid) to authenticated;
grant execute on function public.delete_draft_ride(uuid) to authenticated;
grant execute on function public.cancel_ride(uuid, text) to authenticated;
grant execute on function public.close_ride_recruitment(uuid) to authenticated;
grant execute on function public.reopen_ride_recruitment(uuid) to authenticated;
grant execute on function public.submit_ride_request(uuid, integer, text[]) to authenticated;
grant execute on function public.respond_to_ride_request(uuid, text, text) to authenticated;
grant execute on function public.cancel_ride_request(uuid, text) to authenticated;
