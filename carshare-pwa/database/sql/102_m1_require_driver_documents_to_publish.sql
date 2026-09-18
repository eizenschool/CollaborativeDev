-- Activate only after the document-capable frontend has been released.
-- Existing Published rows are not retroactively cancelled.
create or replace function private.enforce_ride_identity_verification()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.identity_verifications%rowtype;
  v_birth date;
  v_year integer;
  v_check boolean;
begin
  if tg_op = 'INSERT' then v_check := new.status = 'Published';
  else v_check := new.status = 'Published' and old.status is distinct from 'Published';
  end if;
  if not v_check then return new; end if;
  select * into v_row from public.identity_verifications where user_id = new.host_id;
  if v_row.status is null or v_row.status not in ('pending', 'approved')
    or coalesce(v_row.ic_number, '') !~ '^[0-9]{12}$'
    or coalesce(v_row.document_path, '') = ''
    or coalesce(v_row.license_document_path, '') = ''
    then raise exception 'Complete your driver documents in Profile > My Vehicles before publishing'; end if;
  if v_row.license_expiry is null or v_row.license_expiry < current_date
    then raise exception 'Renew your driving licence in Profile > My Vehicles before publishing'; end if;
  if split_part(v_row.document_path, '/', 1) <> new.host_id::text
    or split_part(v_row.license_document_path, '/', 1) <> new.host_id::text
    or not exists(select 1 from storage.objects where bucket_id = 'identity-documents' and name = v_row.document_path)
    or not exists(select 1 from storage.objects where bucket_id = 'identity-documents' and name = v_row.license_document_path)
    then raise exception 'Upload your MyKad and driving licence photos before publishing'; end if;
  v_year := left(v_row.ic_number, 2)::integer;
  v_year := v_year + case when v_year <= extract(year from current_date)::integer % 100 then 2000 else 1900 end;
  begin
    v_birth := make_date(v_year, substring(v_row.ic_number, 3, 2)::integer, substring(v_row.ic_number, 5, 2)::integer);
  exception when others then raise exception 'Enter a valid MyKad birth date'; end;
  if v_birth > (current_date - interval '17 years')::date
    then raise exception 'You must be at least 17 to host'; end if;
  return new;
end;
$$;
revoke all on function private.enforce_ride_identity_verification() from public, anon, authenticated;
