-- Module 4 post-deployment performance-advisor follow-up.
-- Depends on deployed migration 034. Does not depend on pending migration 036.

create index if not exists ride_favourites_ride_id_idx
  on public.ride_favourites (ride_id);
