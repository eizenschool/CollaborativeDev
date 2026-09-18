-- Deploy only after m2-content-cleanup and the two Vault entries are configured.
-- Secrets stay in Vault, never in SQL history or cron command text.
-- m2_content_cleanup_url: full Edge Function URL
-- m2_content_cleanup_secret: same value as Edge M2_CONTENT_CLEANUP_SECRET
begin;
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='m2_content_cleanup_url')
    or not exists(select 1 from vault.decrypted_secrets where name='m2_content_cleanup_secret') then
    raise exception 'Configure the M2 cleanup Vault entries before scheduling';
  end if;
end;
$$;
select cron.schedule('m2-content-cleanup','15 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='m2_content_cleanup_url' limit 1),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='m2_content_cleanup_secret' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);
commit;
