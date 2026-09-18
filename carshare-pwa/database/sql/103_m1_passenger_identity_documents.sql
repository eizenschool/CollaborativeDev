-- Requires 100/101; does not activate pending 102. See docs/ai/SQL.md for deployment status.
-- Passenger identity is MyKad OR Passport, with one private matching photo.
begin;

alter table public.identity_verifications
  add column document_type text not null default 'mykad',
  add column passport_number text,
  add constraint identity_document_choice check (
    (document_type = 'mykad' and passport_number is null)
    or (document_type = 'passport' and ic_number is null
      and passport_number is not null and passport_number ~ '^[A-Z0-9]{5,20}$')
  );

grant insert (document_type, passport_number), update (document_type, passport_number)
  on public.identity_verifications to authenticated;

-- The invoker RPC clears review metadata on resubmission. Column-level
-- privileges must cover those SET targets too; owner RLS still requires
-- status = 'pending', so this does not allow self-approval.
grant update (reviewed_at, review_note) on public.identity_verifications to authenticated;

-- Keep the old RPC for existing MyKad clients. A versioned contract avoids
-- ambiguous PostgREST overloads and never interprets a Passport as MyKad.
create or replace function public.submit_identity_documents_v2(
  p_document_path text, p_document_type text, p_document_number text,
  p_license_expiry date, p_license_document_path text, p_driver boolean
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.identity_verifications%rowtype;
  v_number text;
  v_birth date;
  v_year integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_driver is null then raise exception 'Choose a submission type'; end if;
  if p_document_type is null or p_document_type not in ('mykad', 'passport')
    then raise exception 'Choose IC or Passport'; end if;
  if p_driver and p_document_type <> 'mykad'
    then raise exception 'Drivers must submit MyKad and driving licence documents'; end if;
  v_number := case when p_document_type = 'passport' then upper(btrim(p_document_number))
    else regexp_replace(p_document_number, '[[:space:]-]', '', 'g') end;
  if v_number is null or (p_document_type = 'mykad' and v_number !~ '^[0-9]{12}$')
    or (p_document_type = 'passport' and v_number !~ '^[A-Z0-9]{5,20}$')
    then raise exception 'Enter a valid identity document number'; end if;

  if p_document_path is null or split_part(p_document_path, '/', 1) <> v_user::text
    or not exists(select 1 from storage.objects where bucket_id = 'identity-documents' and name = p_document_path)
    then raise exception 'Upload your identity document photo first'; end if;
  select * into v_row from public.identity_verifications where user_id = v_user for update;
  if found and v_row.document_path = p_document_path
    and (v_row.document_type is distinct from p_document_type
      or (case when v_row.document_type = 'passport' then v_row.passport_number else v_row.ic_number end) is distinct from v_number)
    then raise exception 'Upload a matching photo when changing the document type or number'; end if;

  -- Preserve 101's stricter driver checks; passengers need no age/licence gate.
  if p_driver then
    if substring(v_number, 7, 2) = any(array['00','17','18','19','20','69','70','73','80','81','94','95','96','97'])
      then raise exception 'Enter a valid MyKad birthplace code'; end if;
    v_year := left(v_number, 2)::integer;
    v_year := v_year + case when v_year <= extract(year from current_date)::integer % 100 then 2000 else 1900 end;
    begin
      v_birth := make_date(v_year, substring(v_number, 3, 2)::integer, substring(v_number, 5, 2)::integer);
    exception when others then raise exception 'Enter a valid MyKad birth date'; end;
    if v_birth > (current_date - interval '17 years')::date
      then raise exception 'You must be at least 17 to host'; end if;
    if p_license_expiry is null or p_license_expiry < current_date
      then raise exception 'Enter a current driving licence expiry date'; end if;
    if p_license_document_path is null or split_part(p_license_document_path, '/', 1) <> v_user::text
      or not exists(select 1 from storage.objects where bucket_id = 'identity-documents' and name = p_license_document_path)
      then raise exception 'Upload your driving licence photo first'; end if;
  end if;

  insert into public.identity_verifications as iv
    (user_id, status, document_path, document_type, ic_number, passport_number, license_expiry, license_document_path)
  values(v_user, 'pending', p_document_path, p_document_type,
    case when p_document_type = 'mykad' then v_number else null end,
    case when p_document_type = 'passport' then v_number else null end,
    case when p_driver then p_license_expiry else null end,
    case when p_driver then p_license_document_path else null end)
  on conflict (user_id) do update set
    status = 'pending', document_path = excluded.document_path, document_type = excluded.document_type,
    ic_number = excluded.ic_number, passport_number = excluded.passport_number,
    license_expiry = case when p_driver then excluded.license_expiry else iv.license_expiry end,
    license_document_path = case when p_driver then excluded.license_document_path else iv.license_document_path end,
    submitted_at = now(), reviewed_at = null, review_note = null
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.submit_identity_documents_v2(text,text,text,date,text,boolean) from public, anon;
grant execute on function public.submit_identity_documents_v2(text,text,text,date,text,boolean) to authenticated;

-- Owner/reviewer RLS and the private bucket's 5 MB image restrictions remain.
-- Live preflight found the older status-only publish guard, not 094's IC
-- check. Add only the Passport restriction; do not activate pending 102.
create or replace function private.enforce_ride_driver_identity_type()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'Published' then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status = 'Published' then return new; end if;
  end if;
  if exists(select 1 from public.identity_verifications
    where user_id = new.host_id and document_type = 'passport') then
    raise exception 'Passport is for passenger use. Submit your MyKad and driving licence in My Vehicles before hosting';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_ride_driver_identity_type() from public, anon, authenticated;
create trigger enforce_ride_driver_identity_type_before_publish
before insert or update of status on public.rides
for each row execute function private.enforce_ride_driver_identity_type();

notify pgrst, 'reload schema';
commit;
