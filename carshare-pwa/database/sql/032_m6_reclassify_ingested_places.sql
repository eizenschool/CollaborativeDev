-- Module 6 Destination Discovery: correct the ten rows the Penang / Melaka /
-- Selangor ingestion classified wrongly, and withhold the six that are not
-- destinations at all.
--
-- Why this exists. `classifyPlace` (031's companion change, in
-- `supabase/functions/m6-ingest/classification.ts`) fixes the classification
-- rules going forward, but a fix in the ingestion function does not reach rows
-- that are already in the catalogue: a later sweep takes the free `markSeen`
-- path for a place it already knows and never reclassifies it. These rows were
-- live and visible on /discover, so they are corrected here rather than left to
-- a future re-ingestion that would cost one Enterprise + Atmosphere Place
-- Details request per row.
--
-- The Kuala Lumpur run hit the same thing and its six rows were corrected with
-- a direct REST PATCH, leaving no record in this directory of what was changed.
-- That is what AGENTS.md rule 11 forbids, so this time the correction is a
-- numbered file. It is idempotent and safe to re-run.
--
-- Keyed on `source_place_id`, not `name`: the Google place ID is the catalogue's
-- stable identity and the only field the Maps terms permit storing indefinitely,
-- whereas display names change between enrichment passes.

-- ---------------------------------------------------------------------------
-- 1. Not destinations - withheld, not deleted
-- ---------------------------------------------------------------------------
--
-- Four hotels, a shopping mall and a columbarium. The catalogue sweep asks for
-- `restaurant` and `tourist_attraction` among its included types and these carry
-- both, so they arrived unavoidably; the old classification then filed whatever
-- it could not recognise as `event`, which is how three hotels and a mall became
-- event destinations, and how someone asking "where should I go?" was shown the
-- Summit Hotel USJ.
--
-- `Retired` rather than `delete`, for three reasons: FR-6.4 already withholds
-- Retired places from candidate selection, so no scoring or presentation code
-- needs to learn a new state; `place_interest` and `ride_notify_registration`
-- rows referencing these places survive instead of cascading away; and the
-- decision is reversible if a later judgement disagrees. The ingestion
-- function's `markSeen` restores `Stale` but never `Retired`, so a future sweep
-- will not undo this.
update public.places
set lifecycle_state = 'Retired',
    state_before_demotion = null,
    updated_at = now()
where source_place_id in (
  'ChIJ0_ceR5rDSjARB97A8VgIhfQ',   -- JEN Penang Georgetown by Shangri-La (hotel)
  'ChIJwVTBXltNzDERNMndP7E-rhA',   -- De Palma Hotel Shah Alam (hotel)
  'ChIJWVj37RdNzDER3VixaQiyBQE',   -- Geno Hotel (hotel)
  'ChIJWe7OW5NMzDERHd-apoJI-_k',   -- Summit Hotel USJ (hotel, was filed culinary)
  'ChIJm21YdodMzDERJW_y1EmlGV4',   -- Sunway Pyramid Shopping Mall
  'ChIJSbfvBw1NzDERfaRaSBvxNOI'    -- Nirvana Memorial Park, Shah Alam (columbarium)
)
and lifecycle_state <> 'Retired';

-- ---------------------------------------------------------------------------
-- 2. Real destinations, wrong category
-- ---------------------------------------------------------------------------

-- A UNESCO heritage house that also operates as a boutique hotel and has a
-- restaurant in it. The old rules let the restaurant decide, so the detail
-- screen showed the badge "Culinary" directly above the place's own generated
-- description, "A museum in Penang." Pinned by the `blue mansion` case in
-- classification.test.js.
update public.places
set category = 'heritage', updated_at = now()
where source_place_id = 'ChIJJZ1Pb5rDSjAR0FgEYqphTw0'   -- Cheong Fatt Tze - The Blue Mansion
and category <> 'heritage';

-- A seafront park. The old rules returned heritage the moment Google's
-- `primaryType` was the generic `tourist_attraction`, without ever consulting
-- the type bag that says `park`.
update public.places
set category = 'nature', updated_at = now()
where source_place_id = 'ChIJoclSPwbDSjARZdmGZ8elxrU'   -- Gurney Bay Park
and category <> 'nature';

-- Two built water attractions that came back as nature. The word "park" in
-- `water_park` is not the word in `national_park`; `water_park` now sits in the
-- event type list.
update public.places
set category = 'event', updated_at = now()
where source_place_id in (
  'ChIJJTHt3YhMzDERvM3wesdMZds',   -- Sunway Lagoon
  'ChIJwwJ_X4dSzDERLuyYzgua5s4'    -- Wet World Water Park Shah Alam
)
and category <> 'event';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
--
-- Expected after this file runs: 74 recommendable rows (80 ingested, 6 Retired),
-- and no Retired row in any category count.
--
--   select state, category, count(*)
--   from public.places
--   where lifecycle_state <> 'Retired'
--   group by state, category
--   order by state, category;
--
-- Not corrected here, and deliberately left for a decision rather than guessed
-- at: Melaka holds two near-duplicate pairs from the same sweep - "Jonker Street
-- Night Market" with "Jonker Walk Melaka", and the two "Melaka River Cruise
-- Jeti" landings. They are separate Google places, so ingestion is behaving
-- correctly, but ChainDetection (FR-6.26) scores name recurrence within a state
-- and may read each pair as a chain and penalise a genuine single attraction on
-- "Independently run". That needs a rule change or a judgement call, not an
-- update statement.
