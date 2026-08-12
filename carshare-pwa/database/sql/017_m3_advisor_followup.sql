-- Cover the direct_user_id foreign key for profile deletion and direct-chat lookups.
-- The unique (ride_id, direct_user_id) index cannot serve queries led by user id.
create index conversations_direct_user_id_idx
  on public.conversations (direct_user_id)
  where direct_user_id is not null;
