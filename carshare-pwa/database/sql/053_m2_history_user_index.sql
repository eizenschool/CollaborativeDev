-- Make the location-history user foreign key independently indexable while
-- retaining the ride-first playback index.
create index if not exists m2_location_history_user_fk_idx
  on private.m2_location_history (user_id, ride_id, captured_at, id);
