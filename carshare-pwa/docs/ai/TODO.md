# TODO.md

Project-level coordination only. Module work belongs in `docs/ai/modules/Mx_*.md`.

## NOW
- [x] Inspect the real GitHub repository and branch structure.
- [x] Define shared-core + per-module AI context architecture.
- [x] Align AI context with Codex + Claude Code and Karpathy 4 Rules.
- [ ] Add this V1.1 context package to a Git branch and review through PR.
- [ ] Confirm which existing module branches continue and which should be refreshed from `Development`.
- [ ] Review `Development` as the integration baseline before new feature work.

## NEXT
- [ ] Update module file maps during each module's next task.
- [ ] Review CI branch names because the workflow references `dev` while the repository uses `Development`.
- [ ] Review stale OpenStreetMap/map-tile assumptions before Google Maps integration.
- [ ] Decide the next integrated vertical slice based on current code.

## BLOCKED / NEEDS TEAM CONFIRMATION
- Long-lived Module1–Module6 branches vs gradually moving to short-lived feature branches.
- Several existing module branches are behind current `Development`.
- Module 1 + Module 2 schema/RLS drafted as `database/sql/001-007` (D010) - needs Module 2 owner sign-off on `006-007` (`rides`), then a live Supabase project to actually run against and validate.
- Google Maps API setup is not yet recorded as verified repository configuration.
