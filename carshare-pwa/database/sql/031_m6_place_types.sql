-- Module 6 Destination Discovery: keep the Google type data that classification
-- is derived from, so a classification fix can be re-applied without paying for
-- enrichment again.
--
-- Why this exists. `categoryFor` in the ingestion function decides a place's
-- category from Google's `types` bag and its `primaryType`, and then throws both
-- away: only the derived `category` was ever stored. That made every
-- classification bug unfixable except by re-running enrichment, which is the
-- Enterprise + Atmosphere request (024's cost note, MODULE6-API-SETUP.md §4) -
-- the single most expensive call this module makes. The Kuala Lumpur run hit
-- exactly this: six rows were wrong, the code was fixed, and the rows had to be
-- corrected by hand because nothing in the database recorded what Google had
-- actually said about them.
--
-- The Penang / Melaka / Selangor ingestion hit it again at four times the scale.
-- Storing the inputs makes reclassification a pure SQL or client-side operation
-- over data already paid for, instead of a second visit to Google.
--
-- Cost note: `types` and `primaryType` are Essentials-tier fields. They are
-- already present in both requests the ingestion function makes - the catalogue
-- sweep's field mask asks for `places.types`, and the enrichment mask asks for
-- both. Nothing here adds a request or moves a request to a higher tier.
--
-- COMPLIANCE NOTE (scope of the accepted risk recorded in 024 and 027):
-- These are Google's own classification labels for a place, not user-generated
-- content and not the descriptive fields the Maps terms restrict. They are
-- stored for the same reason 024 stores rating and review_count - FR-6.11
-- forbids enrichment at request time - and they are never displayed. No new
-- category of cached content is introduced by this file.

-- ---------------------------------------------------------------------------
-- Classification inputs
-- ---------------------------------------------------------------------------

-- text[] rather than jsonb: this is a flat list of short tokens that is only
-- ever scanned for membership, which is what an array operator does natively.
-- jsonb would buy nothing and would need casting on every read.
alter table public.places
  add column if not exists types text[] not null default '{}';

comment on column public.places.types is
  'Google Places `types` for this place, as returned by the enrichment pass. '
  'An input to classification, not a displayed field - see 031.';

-- Google's own single classification for the place. Nullable rather than
-- defaulted to '': the enrichment response genuinely omits it for some places,
-- and "Google did not say" is different from "Google said empty".
alter table public.places
  add column if not exists primary_type text;

comment on column public.places.primary_type is
  'Google Places `primaryType`, the place''s own single classification. Checked '
  'before `types` when deriving `category` - see 031.';

-- ---------------------------------------------------------------------------
-- Grants - deliberately none
-- ---------------------------------------------------------------------------
--
-- `authenticated` needs no statement here: 024 granted SELECT on the table
-- rather than on a column list, so it picks both columns up automatically.
--
-- `anon` is deliberately NOT granted either column. 030's header records why a
-- missing anon grant once broke anonymous browsing outright: the shared adapter
-- `discoverySupabaseRepository.js` uses one fixed PLACE_SELECT list for every
-- caller, so one ungranted column in that list denies the entire query. The
-- safety condition is therefore about the select list, not about the table -
-- and these two columns are not in PLACE_SELECT and must not be added to it.
-- They exist for the ingestion function (which writes with the secret key and
-- bypasses RLS) and for maintenance queries, not for the UI. Adding a grant
-- here would widen anon's read for no caller that asks.

-- No index. These columns are never filtered or sorted on by any query the
-- module runs; they are read only when reclassifying the catalogue, which is a
-- full scan of 80 rows by design.
