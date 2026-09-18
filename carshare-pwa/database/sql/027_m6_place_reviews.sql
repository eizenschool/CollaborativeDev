-- Module 6 Destination Discovery: store the reviews the enrichment pass already
-- pays for, so they can be displayed with their authors' names.
--
-- Why this exists. The ingestion function requests `reviews` from Place Details,
-- which is what prices every enrichment request at the Enterprise + Atmosphere
-- tier. Until now the response was used for exactly one thing: the text of the
-- first review was written into `places.description` verbatim, presented as the
-- application's own description of the place with no attribution, and the other
-- four were discarded. That produced descriptions like "Awesome and amazing and
-- better than expectation!!!" for Central Market, and one for Merdeka Square
-- naming the hotel its author had stayed in.
--
-- This column holds them as what they are - attributed reviews - so the detail
-- screen can credit each author, and `description` goes back to the neutral
-- generated sentence FR-6.8 specifies.
--
-- COMPLIANCE NOTE (extends the accepted risk recorded in 024):
-- Google Maps Platform terms ask for review content to be requested live and
-- displayed with attribution rather than warehoused. 024 already records the
-- team's accepted deviation for rating, review_count, description and photo
-- references; this column extends that same deviation to review text, for the
-- same reason - FR-6.11 forbids enrichment at request time. Every stored review
-- carries its author, and the detail screen displays that author, so the
-- attribution requirement is met even though the caching one is not. This must
-- be carried into the report's limitations section alongside the 024 note.

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------

-- jsonb rather than a child table: reviews are replaced wholesale on every
-- enrichment pass, are never queried across places, and are read only when one
-- place's detail screen is opened. A table would add a join and a delete cycle
-- for no query this module performs.
--
-- Shape, matching what the detail screen renders:
--   [{ "author": text, "rating": number|null, "text": text }]
alter table public.places
  add column if not exists reviews jsonb not null default '[]'::jsonb;

comment on column public.places.reviews is
  'Up to five Place Details reviews, each with author attribution. Replaced '
  'wholesale by the enrichment pass. See the compliance note in 027.';

-- Guard the shape rather than trusting the writer: this column is written by an
-- Edge Function and read straight into the UI, so a malformed value would reach
-- the screen. An array is the only thing the detail screen can map over.
alter table public.places
  drop constraint if exists places_reviews_is_array;

alter table public.places
  add constraint places_reviews_is_array
  check (jsonb_typeof(reviews) = 'array');

-- No index. Reviews are never filtered or sorted on - they are read only as
-- part of the single row a detail screen already fetches by primary key.
