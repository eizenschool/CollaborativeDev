-- Cleanup for two bugs found after the 2026-09-04 Labuan/Perlis sweeps
-- (fixed in code: supabase/functions/m6-ingest/index.ts, address.ts).
--
-- Run each SELECT first and read the rows before running the matching
-- UPDATE/DELETE. Nothing here is reversible once run.

-- ============================================================
-- 1. Merge "Labuan Federal Territory" into "Labuan"
--    (address.ts was missing this exact word order as an alias, so the
--    same real state split into two groups under two different strings)
-- ============================================================

-- Look first:
select id, name, state from places where state = 'Labuan Federal Territory';

-- Then merge:
update places set state = 'Labuan' where state = 'Labuan Federal Territory';


-- ============================================================
-- 2. Retire places outside Malaysia
--    (the sweep's enrichment loop never checked country before this fix -
--    Labuan's 50km circle reached into Brunei, Perlis's reached into
--    Thailand). Retiring rather than deleting keeps place_interest /
--    ride history rows intact and out of every recommendable query, the
--    same pattern 032_m6_reclassify_ingested_places.sql used.
-- ============================================================

-- Look first - review every row named here before retiring anything:
select id, name, state, category, lifecycle_state
from places
where state in ('Daerah Brunei-Muara', 'Brunei-Muara District', 'Chang Wat Songkhla');

-- Then retire:
update places
set lifecycle_state = 'Retired'
where state in ('Daerah Brunei-Muara', 'Brunei-Muara District', 'Chang Wat Songkhla');


-- ============================================================
-- 3. Verify
-- ============================================================
select state, count(*)
from places
where lifecycle_state in ('Active', 'Provisional')
group by state
order by count(*) desc;
