-- Complete the Module 2 dispute notification contract without rewriting 043.
-- Resolution notifications contain only the case/action result, never GPS.

create or replace function public.resolve_m2_ride_dispute(p_case_id uuid, p_status text, p_resolution text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := auth.uid();
  v_count integer;
  v_ride_id uuid;
  v_opened_by uuid;
begin
  if p_status not in ('Resolved', 'Dismissed') or nullif(btrim(p_resolution), '') is null then
    raise exception 'A resolution and final status are required';
  end if;
  if not exists (select 1 from private.project_user_roles where user_id = v_admin and role = 'trust_admin') then
    raise exception 'Trust Admin access required';
  end if;
  update private.m2_ride_disputes
  set status = p_status, resolution = btrim(p_resolution), resolved_at = now(), updated_at = now()
  where id = p_case_id and assigned_admin_id = v_admin and status = 'Under Review'
  returning ride_id, opened_by into v_ride_id, v_opened_by;
  get diagnostics v_count = row_count;
  if v_count = 1 then
    update private.m2_location_evidence_holds
    set active_until = now() + interval '90 days'
    where ride_id = v_ride_id;
    perform private.create_user_notification(
      v_opened_by, 'm2', 'ride_dispute_resolved', 'Ride issue review completed',
      case when p_status = 'Resolved' then 'Trust Admin resolved your ride issue.' else 'Trust Admin dismissed your ride issue.' end,
      '/safety/admin', jsonb_build_object('case_id', p_case_id, 'status', p_status),
      'm2:dispute:resolved:' || p_case_id::text
    );
  end if;
  return v_count = 1;
end;
$$;

revoke all on function public.resolve_m2_ride_dispute(uuid, text, text) from public, anon;
grant execute on function public.resolve_m2_ride_dispute(uuid, text, text) to authenticated;
