-- Module 2 mutual post-ride reviews and account-level public star averages.

create table public.ride_reviews (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewee_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  constraint ride_reviews_different_people_check check (reviewer_id <> reviewee_id),
  constraint ride_reviews_one_direction_key unique (ride_id, reviewer_id, reviewee_id)
);

create index ride_reviews_reviewee_created_idx
  on public.ride_reviews (reviewee_id, created_at desc);
create index ride_reviews_reviewer_created_idx
  on public.ride_reviews (reviewer_id, created_at desc);

alter table public.ride_reviews enable row level security;

create policy "authenticated users read reviews"
  on public.ride_reviews for select to authenticated
  using (true);

revoke all on table public.ride_reviews from public, anon, authenticated;
grant select on table public.ride_reviews to authenticated;

create or replace function public.recalculate_reviewee_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.host_impact_stats
  set rating = (
        select round(avg(rr.rating)::numeric, 2)
        from public.ride_reviews rr
        where rr.reviewee_id = new.reviewee_id
      ),
      updated_at = now()
  where user_id = new.reviewee_id;

  return new;
end;
$$;

revoke all on function public.recalculate_reviewee_rating()
  from public, anon, authenticated;

create trigger recalculate_reviewee_rating_after_insert
after insert on public.ride_reviews
for each row execute function public.recalculate_reviewee_rating();

create or replace function public.submit_ride_review(
  p_ride_id uuid,
  p_reviewee_id uuid,
  p_rating integer,
  p_comment text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_review_id uuid;
  v_is_valid_direction boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if char_length(coalesce(p_comment, '')) > 500 then
    raise exception 'Review comments are limited to 500 characters';
  end if;

  select * into v_ride from public.rides where id = p_ride_id;
  if not found or v_ride.status <> 'Completed' then
    raise exception 'Only Completed rides can be reviewed';
  end if;

  v_is_valid_direction := (
    v_user_id = v_ride.host_id
    and exists (
      select 1
      from public.ride_requests rr
      where rr.ride_id = p_ride_id
        and rr.requester_id = p_reviewee_id
        and rr.status = 'Accepted'
    )
  ) or (
    p_reviewee_id = v_ride.host_id
    and exists (
      select 1
      from public.ride_requests rr
      where rr.ride_id = p_ride_id
        and rr.requester_id = v_user_id
        and rr.status = 'Accepted'
    )
  );

  if not v_is_valid_direction then
    raise exception 'You are not eligible to review this person for this ride';
  end if;

  insert into public.ride_reviews (
    ride_id, reviewer_id, reviewee_id, rating, comment
  ) values (
    p_ride_id, v_user_id, p_reviewee_id, p_rating, btrim(coalesce(p_comment, ''))
  ) returning id into v_review_id;

  return v_review_id;
exception
  when unique_violation then
    raise exception 'You have already submitted this review';
end;
$$;

create or replace function public.get_ride_review_eligibility(p_ride_id uuid)
returns table (
  reviewee_id uuid,
  reviewee_name text,
  reviewee_avatar_url text,
  reviewer_role text,
  existing_rating integer,
  existing_comment text,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_ride as (
    select r.id, r.host_id, r.status
    from public.rides r
    where r.id = p_ride_id
      and r.status = 'Completed'
  ), eligible as (
    select rr.requester_id as person_id, 'Host'::text as reviewer_role
    from target_ride tr
    join public.ride_requests rr on rr.ride_id = tr.id
    where tr.host_id = auth.uid()
      and rr.status = 'Accepted'

    union all

    select tr.host_id as person_id, 'Passenger'::text as reviewer_role
    from target_ride tr
    where exists (
      select 1
      from public.ride_requests rr
      where rr.ride_id = tr.id
        and rr.requester_id = auth.uid()
        and rr.status = 'Accepted'
    )
  )
  select
    e.person_id,
    p.full_name,
    p.profile_photo_url,
    e.reviewer_role,
    rv.rating,
    rv.comment,
    rv.created_at
  from eligible e
  join public.profiles p on p.id = e.person_id
  left join public.ride_reviews rv
    on rv.ride_id = p_ride_id
   and rv.reviewer_id = auth.uid()
   and rv.reviewee_id = e.person_id
  order by p.full_name;
$$;

revoke all on function public.submit_ride_review(uuid, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.get_ride_review_eligibility(uuid)
  from public, anon, authenticated;
grant execute on function public.submit_ride_review(uuid, uuid, integer, text)
  to authenticated;
grant execute on function public.get_ride_review_eligibility(uuid)
  to authenticated;
