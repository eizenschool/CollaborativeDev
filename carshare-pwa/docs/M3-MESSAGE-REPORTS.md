# Message reports

Implemented 2026-09-16. Backend deployed to `pnetstmovctfwqcumodx` (Tokyo), the existing application's project. The frontend change is in this working tree and requires the normal application release.

## User and administrator flow

- Received user text, images, videos and audio have **Report message** in the message menu. Self, system, deleted and location-only messages are excluded. The server requires current message visibility.
- Submission saves a server-generated snapshot and private copies of attachments before reporting success. If editing/deletion wins the copy race, submission fails and requests a fresh report. Once submitted, Delete for me, sender editing/deletion and conversation cleanup do not remove evidence.
- Reports appear in the existing `/admin/conduct` queue. **Review message evidence** loads only the selected message, not the conversation. Five-minute media URLs can be refreshed.
- Administrators dismiss, record a warning without deducting points, or apply the existing four severity tiers and escalation/hold policy. Reporters receive a privacy-safe reviewed result. The sender is notified only for a warning or confirmed violation; dismissed reports do not notify the sender or reveal the reporter's identity.
- The message review endpoint groups reports by message version and atomically closes them with at most one reputation event. The legacy profile-report resolution endpoint cannot bypass it. Admin removal leaves a tombstone and removes original attachments; an edited replacement is not silently removed.

## Resource controls and retention

- Only reported content is copied. Other messages incur no report-processing calls.
- One persistent copy per message version. Simultaneous submissions can temporarily copy twice; the duplicate is removed immediately or by cleanup after a failed request.
- At most three preparations per minute and twenty per rolling day per account. Attempts older than one day are removed by the cleanup worker; pending attempts cannot finalize after ten minutes.
- Open evidence is retained for review. Closed evidence text and media are purged after 90 days; report reasons, decisions and reputation audit entries remain. Cleanup runs hourly in batches (25 evidence records, 100 attempts); expiry can lag the threshold while a backlog drains.
- The main cost is private media storage and administrator playback/download traffic, not text rows. For example, ten distinct 10 MB reported attachments require about 100 MB of extra persistent storage until expiry. This is not a promise to stay within a free quota. Large videos and high report volume need usage monitoring.
- The cleanup token lives in Vault. The Edge Function verifies that token for cleanup or validates a user JWT for interactive actions. No service key reaches the browser. Both evidence tables deny direct client access; the evidence bucket has no client policies.

## Deployment and validation

- `109_m3_message_reports.sql` / live migration `20260916041406_m3_message_reports` adds evidence, report linkage, protected RPCs, the private bucket and hourly job. `110_m3_message_report_cleanup_indexes.sql` / live `20260916042030_m3_message_report_cleanup_indexes` indexes expiration and grouped resolution.
- Deployed `111_m3_fix_message_report_admin_queue.sql` (`20260916113610_fix_message_report_admin_queue`) restores `messageEvidenceId` in the queue response. Without it, the UI shows ordinary `Mark resolved` / `Dismiss` controls and the database correctly rejects them with `Use the message evidence review action`.
- Deployed `112_project_safety_report_notifications.sql` as `20260916120535_safety_report_notifications`. It sends deduplicated results through the existing notification inbox for both profile and message reports. Confirmed outcomes show the actual post-escalation reputation deduction; warning outcomes show that no points were deducted.
- Existing M1 `apply_conduct_outcome`, admin allowlist and report queue were inspected live before deployment. No old reputation origin/threshold migration was applied.
- Edge Function `m3-message-reports` uses its own JWT check (`verify_jwt=false`) because the scheduled cleanup uses a dedicated token. Its dependency is pinned. The cron URL targets the project above; change it for another deployment.
- Build, layer validation, 80 relevant unit tests, 12 browser tests across four viewports, and in-memory PostgreSQL integration tests verify the feature. UI fixtures substitute service responses; a signed-in live photo/video/voice acceptance pass remains required. Production checks verified private storage, restrictive grants, anonymous rejection and a successful scheduled cleanup HTTP response.
- Database advisors flag the intentional authenticated SECURITY DEFINER entrypoints and evidence tables with no client policies. The entrypoints enforce visibility/admin authorization; finalization and cleanup authorization are service-role-only.

Run the SQL integration harness from the app root with `PGLITE_MODULE` pointing to an installed `@electric-sql/pglite/dist/index.js`, then `node tests/contracts/m3/MessageReports.integration.mjs`. It creates an isolated PostgreSQL database and never modifies production data. Auth/storage and the pre-existing reputation event writer are minimal fixtures; the new migration and severity routine are executed as SQL.
