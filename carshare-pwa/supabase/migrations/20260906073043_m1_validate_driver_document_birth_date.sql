create or replace function public.submit_identity_documents(
  p_document_path text, p_ic_number text, p_license_expiry date,
  p_license_document_path text, p_driver boolean
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.identity_verifications%rowtype;
  v_ic text := replace(btrim(p_ic_number), '-', '');
  v_birth date;
  v_year integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_driver is null then raise exception 'Choose a submission type'; end if;
  if v_ic is null or v_ic !~ '^[0-9]{12}$' then raise exception 'Enter a valid MyKad number'; end if;
  if substring(v_ic, 7, 2) = any(array['00','17','18','19','20','69','70','73','80','81','94','95','96','97'])
    then raise exception 'Enter a valid MyKad birthplace code'; end if;
  v_year := left(v_ic, 2)::integer;
  v_year := v_year + case when v_year <= extract(year from current_date)::integer % 100 then 2000 else 1900 end;
  begin
    v_birth := make_date(v_year, substring(v_ic, 3, 2)::integer, substring(v_ic, 5, 2)::integer);
  exception when others then raise exception 'Enter a valid MyKad birth date'; end;
  if p_driver and v_birth > (current_date - interval '17 years')::date
    then raise exception 'You must be at least 17 to host'; end if;
  if p_document_path is null or split_part(p_document_path, '/', 1) <> v_user::text
    or not exists(select 1 from storage.objects where bucket_id = 'identity-documents' and name = p_document_path)
    then raise exception 'Upload your MyKad photo first'; end if;
  if p_driver then
    if p_license_expiry is null or p_license_expiry < current_date then raise exception 'Enter a current driving licence expiry date'; end if;
    if p_license_document_path is null or split_part(p_license_document_path, '/', 1) <> v_user::text
      or not exists(select 1 from storage.objects where bucket_id = 'identity-documents' and name = p_license_document_path)
      then raise exception 'Upload your driving licence photo first'; end if;
  end if;
  insert into public.identity_verifications as iv
    (user_id, status, document_path, ic_number, license_expiry, license_document_path)
  values(v_user, 'pending', p_document_path, v_ic,
    case when p_driver then p_license_expiry else null end,
    case when p_driver then p_license_document_path else null end)
  on conflict (user_id) do update set
    status = 'pending', document_path = excluded.document_path, ic_number = excluded.ic_number,
    license_expiry = case when p_driver then excluded.license_expiry else iv.license_expiry end,
    license_document_path = case when p_driver then excluded.license_document_path else iv.license_document_path end,
    submitted_at = now(), reviewed_at = null, review_note = null
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.submit_identity_documents(text,text,date,text,boolean) from public, anon;
grant execute on function public.submit_identity_documents(text,text,date,text,boolean) to authenticated;
