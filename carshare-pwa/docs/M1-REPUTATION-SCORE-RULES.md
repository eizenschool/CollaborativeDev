# Module 1 — Reputation Score Rules (current state)

Reference sheet for what actually moves a member's reputation score today.
Source of truth remains the code and SQL below — update this file if either
changes; do not let it drift into its own authority.

Primary sources: [`ReputationPolicy.js`](../src/business-logic/m1-profile/ReputationPolicy.js),
[`072_m1_reputation_events_and_eligibility.sql`](../database/sql/072_m1_reputation_events_and_eligibility.sql),
[`087_m1_reputation_starts_at_ceiling.sql`](../database/sql/087_m1_reputation_starts_at_ceiling.sql),
[`078_m1_conduct_outcome_and_hold_reversal.sql`](../database/sql/078_m1_conduct_outcome_and_hold_reversal.sql),
[`104_m1_graduated_conduct_severity.sql`](../database/sql/104_m1_graduated_conduct_severity.sql).

## Design principle

Reputation measures **verified ride behaviour only**. Login frequency, profile
completeness, CO2 impact, vehicle count, and identity/licence verification are
deliberately excluded — those are engagement, impact, or eligibility signals,
not evidence that someone reliably carried or travelled with another person.
Identity verification is enforced as a separate, non-scoring **gate**
(`private.enforce_ride_identity_verification` blocks publishing outright,
independent of the score) — see the "What does NOT affect the score" section.

Every member starts at the **100 ceiling**. Score is clamped to 100 per event
(not once at the end), so positive credit earned while already at 100 is
spent, not banked against a later penalty. Score never drops below 0.

## Automatic events (fire from ride/review data, no human judgment)

Already deployed and live via the `reputation_after_review_insert`,
`reputation_after_ride_status`, and `reputation_after_request_status`
triggers.

| Event | Delta | Fires on |
|---|---|---|
| Ride completed | +1 | Ride status → `Completed` |
| On-time check-in | +1 | Verified check-in |
| 5★ review | +2 | `submit_ride_review` |
| 4★ review | +1 | `submit_ride_review` |
| 3★ review | 0 | `submit_ride_review` |
| 2★ review | −3 | `submit_ride_review` |
| 1★ review | −6 | `submit_ride_review` |
| Cancel >24h before departure | −1 | Host or traveller cancellation |
| Cancel 6–24h before departure | −3 | Host or traveller cancellation |
| Cancel <6h before departure | −6 | Host or traveller cancellation |
| No-show | −10 | Verified no-show after grace window |

**+3-per-ride cap:** all positive events on the same ride combine but never
exceed +3 total (e.g. `ride_completed` +1 and a 5★ review +2 together hit the
cap exactly; a 4★ review on top would add nothing further).

## Manual events — confirmed conduct (Trust Case, reviewer-adjudicated)

Not automatic — a human reviewer must classify a case before
`private.apply_conduct_outcome` is called. **Authored, not yet deployed**
(depends on `078_m1`, which is itself not deployed) and **no reviewer UI
exists yet** — only reachable via the Supabase SQL editor today.

| Tier | Delta | Automatic hold? | Escalates to next tier after |
|---|---|---|---|
| Minor | −8 | No | 3rd confirmed minor within 90 days → Moderate |
| Moderate | −14 | No | 2nd confirmed moderate within 180 days → Serious |
| Serious | −20 | **Yes** | 2nd confirmed serious (ever) → Severe |
| Severe | −30 | **Yes** | Ceiling — does not escalate further |

A hold blocks all ride actions regardless of score, until
`private.clear_reputation_hold` runs following a documented appeal outcome.
The escalated event is what gets recorded — the reviewer's original
classification is preserved in `metadata.requestedType`.

## Eligibility gates (read the score, don't change it)

| Action | Client policy (`ReputationPolicy.js`) | Currently live on the database |
|---|---|---|
| Publish a ride (host) | Score ≥ 90 | Score ≥ 65 |
| Request a ride (traveller) | Score ≥ 75 | Score ≥ 50 |
| Provisional window | First 3 evidence rides | First 3 evidence rides |
| Safety hold | Blocks regardless of score | Blocks regardless of score |

**Known gap:** the client already reflects the accepted D034 gates (90/75,
100-origin), but the deployed database still runs the older D030 gates
(65/50, 70-origin) because reconciling migration `087_m1` is authored but not
deployed. The event deltas above are unaffected by this gap and already work
correctly in production — only the pass/fail threshold differs.

## Tier labels

Trusted 95+ · Standard 90+ · Limited 75+ · Restricted 50+ · below 50 or a hold
= Safety hold.

## Manual event — identity verification overdue (105_m1)

One deliberate, narrow exception to "identity does not affect reputation."
Not automatic, no cron/worker: a reviewer opens the "Not verified" tab on
`/admin/identity`, sees every active member with **zero** `identity_verifications`
row at all (never submitted anything - a pending or rejected row already
belongs on the other tabs) and how many days since they signed up, and may
choose to apply a penalty.

| Event | Delta | Hold? | Applies to |
|---|---|---|---|
| Identity verification overdue | −5 | No | All active members, from signup |

One penalty per member per calendar day (`source_event_id` is day-scoped, so
a double click can't double it; a still-unverified member can be flagged
again on a later day). Lighter than confirmed-minor-conduct (−8) on purpose —
this is an administrative lapse, not misconduct. **Authored, not yet
deployed** — until `105_m1` runs on the shared project, the admin tab's RPC
404s and the client shows an empty list rather than an error.

## What does NOT affect the score

Ordinary login, profile completeness, CO2/impact stats, vehicle count, badge
tier, and identity/licence verification status **beyond the one exception
above**. A member who never verifies their identity cannot publish a ride
(blocked by `private.enforce_ride_identity_verification` with an error, not a
deduction) — that gate is unrelated to the manual overdue penalty, which
applies to every member regardless of whether they ever intend to host.
