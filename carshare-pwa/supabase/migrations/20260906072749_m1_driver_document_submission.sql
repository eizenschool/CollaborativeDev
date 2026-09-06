-- Account-level driver documents. Compatible expansion; publish enforcement
-- is a separate migration so an older frontend can continue during rollout.
alter table public.identity_verifications add column if not exists license_document_path text;
grant insert (license_document_path), update (license_document_path)
  on public.identity_verifications to authenticated;

create or replace function public.submit_identity_documents(
  p_document_path text, p_ic_number text, p_license_expiry date,
  p_license_document_path text, p_driver boolean
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.identity_verifications%rowtype;
  v_ic text := replace(btrim(p_ic_number), '-', '');
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_driver is null then raise exception 'Choose a submission type'; end if;
  if v_ic is null or v_ic !~ '^[0-9]{12}$' then raise exception 'Enter a valid MyKad number'; end if;
  -- Check a real YYMMDD date (either century) and the shared birthplace allowlist.
  if substring(v_ic, 7, 2) = any(array['00','17','18','19','20','69','70','73','80','81','94','95','96','97'])
    or not (
      to_char(to_date('19' || left(v_ic, 6), 'YYYYMMDD'), 'YYYYMMDD') = '19' || left(v_ic, 6)
      or to_char(to_date('20' || left(v_ic, 6), 'YYYYMMDD'), 'YYYYMMDD') = '20' || left(v_ic, 6)
    ) then raise exception 'Enter a valid MyKad number'; end if;
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
