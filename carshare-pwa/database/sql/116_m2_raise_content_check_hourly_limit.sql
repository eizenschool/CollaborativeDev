-- M2 moderation uses one request for text and one for a newly selected photo.
-- Allow about twenty complete publish/edit attempts per Host per hour while
-- retaining a bounded server-side guard for the shared provider allowance.
begin;

create or replace function public.consume_m2_content_quota(p_host_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare n integer;
begin
  insert into public.m2_content_rate_limits values(p_host_id,date_trunc('hour',now()),1)
  on conflict(host_id,hour) do update set attempts=m2_content_rate_limits.attempts+1
  returning attempts into n;
  if n>40 then raise exception 'CONTENT_CHECK_RATE_LIMIT'; end if;
  delete from public.m2_content_rate_limits where hour < now()-interval '2 days';
end;
$$;

commit;
