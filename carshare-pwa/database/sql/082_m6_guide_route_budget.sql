-- Module 6 / Tumpang Guide route sub-budget.
--
-- The Guide gets its own, much smaller daily allowance so it can never
-- starve Module 2's paid ride quote/publish flow, and every Guide route it
-- does spend also consumes the shared global slot (public.consume_m2_route_
-- quota, database/sql/028_m2_route_schedule_and_completion.sql) so the
-- 250/day Google cap still holds across both modules. Same Asia/Kuala_Lumpur
-- day boundary and same per-request-id idempotency as that function.

create schema if not exists private;

create table if not exists private.m6_guide_route_daily_usage (
  usage_date date primary key,
  request_count integer not null default 0 check (request_count between 0 and 40),
  updated_at timestamptz not null default now()
);

create table if not exists private.m6_guide_route_usage_requests (
  request_id uuid primary key,
  usage_date date not null
    references private.m6_guide_route_daily_usage(usage_date) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on table private.m6_guide_route_daily_usage from public, anon, authenticated;
revoke all on table private.m6_guide_route_usage_requests from public, anon, authenticated;

create or replace function public.consume_m6_guide_route_quota(p_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_count integer;
begin
  if p_request_id is null then
    raise exception 'A Guide route request id is required';
  end if;

  -- Idempotent: replaying the same request id never spends a second slot.
  select d.request_count into v_count
  from private.m6_guide_route_usage_requests r
  join private.m6_guide_route_daily_usage d on d.usage_date = r.usage_date
  where r.request_id = p_request_id;
  if found then
    return v_count;
  end if;

  insert into private.m6_guide_route_daily_usage (usage_date)
  values (v_usage_date)
  on conflict (usage_date) do nothing;

  select request_count into v_count
  from private.m6_guide_route_daily_usage
  where usage_date = v_usage_date
  for update;

  if exists (select 1 from private.m6_guide_route_usage_requests
             where request_id = p_request_id) then
    return v_count;
  end if;

  -- The Guide's own cap is checked FIRST so the common exhaustion case has a
  -- distinguishable message the Edge Function can map to its own
  -- degradation (routeInfo.ts::classifyQuotaError), before ever touching
  -- the shared global counter.
  if v_count >= 40 then
    raise exception 'M6_GUIDE_ROUTE_BUDGET: the Guide daily route allowance is used up';
  end if;

  -- Consume the SHARED Google slot in the same transaction and with the SAME
  -- request id. If the global 250/day cap is already reached this raises and
  -- the Guide row above rolls back with it, so the two counters can never
  -- drift apart. Called with an explicit public. prefix because search_path
  -- is empty; the surrounding SECURITY DEFINER context retains EXECUTE even
  -- though the inner function is revoked from public/anon/authenticated.
  perform public.consume_m2_route_quota(p_request_id);

  insert into private.m6_guide_route_usage_requests (request_id, usage_date)
  values (p_request_id, v_usage_date);

  update private.m6_guide_route_daily_usage
  set request_count = request_count + 1, updated_at = now()
  where usage_date = v_usage_date
  returning request_count into v_count;

  return v_count;
end;
$$;

revoke all on function public.consume_m6_guide_route_quota(uuid)
  from public, anon, authenticated;
grant execute on function public.consume_m6_guide_route_quota(uuid) to service_role;
