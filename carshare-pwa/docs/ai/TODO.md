# TODO.md

Project-level coordination only. Module work belongs in `docs/ai/modules/Mx_*.md`.

## NOW
- [x] Inspect the real GitHub repository and branch structure.
- [x] Define shared-core + per-module AI context architecture.
- [x] Align AI context with Codex + Claude Code and Karpathy 4 Rules.
- [ ] Add this V1.1 context package to a Git branch and review through PR.
- [ ] Confirm which existing module branches continue and which should be refreshed from `Development`.
- [ ] Review `Development` as the integration baseline before new feature work.
- [x] Replace Module 2 route placeholders with a zero-charge Google Maps Embed integration and local fallback.
- [x] Remove stale OpenStreetMap tile-cache assumptions from the PWA configuration.

## NEXT
- [ ] Update module file maps during each module's next task.
- [ ] Review CI branch names because the workflow references `dev` while the repository uses `Development`.
- [ ] Enable Maps Embed API only in `my-project-cd-505310` and create a website/API-restricted key.
- [ ] Add the final HTTPS deployment referrer to the restricted Maps Embed key.
- [ ] Decide the next integrated vertical slice based on current code.

## BLOCKED / NEEDS TEAM CONFIRMATION
- Long-lived Module1–Module6 branches vs gradually moving to short-lived feature branches.
- Several existing module branches are behind current `Development`.
- Google Cloud Console setup remains unverified until the restricted Embed-only key is created. Billable Maps SKUs stay disabled except the Module 6 catalogue SKUs accepted in D018.
- D018 needs Console work before Module 6 ingestion can run against live data: authorise Nearby/Text Search, Place Details and Place Photos, and create a **server-side** key (the two existing keys are website-restricted and unusable from an Edge Function). Store it as a Supabase secret with no `VITE_` prefix.
- Module 6 caches Google place content that the Maps Platform terms say should not be stored (D018). Accepted as a prototype limitation; it must appear in the report's limitations section.
- `/discover` is public under D017, but `024`'s `places` policy grants SELECT to `authenticated` only. That is consistent today because the screen runs on the local fixture catalogue, but once `024` is deployed and Supabase becomes the source, a signed-out visitor would see an empty catalogue. Granting `anon` read on `places` needs the same explicit public-payload approval D017 requires - it has deliberately not been added unilaterally.
- Google OAuth (D015): code is in place, but someone with Supabase Dashboard + Google Cloud Console access still needs to register the OAuth Client ID/Secret and enable the provider - see `docs/SUPABASE-SETUP.md`. Cannot demo "Continue with Google" against the live project until that's done.
