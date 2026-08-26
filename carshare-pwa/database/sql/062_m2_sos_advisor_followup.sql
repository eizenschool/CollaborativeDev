-- Cover foreign keys reported by the post-061 Supabase performance advisor.
-- These indexes do not change the Trusted Family or SOS authorization model.

create index if not exists m2_trusted_family_invites_owner_idx
  on private.m2_trusted_family_invites (owner_id);

create index if not exists m2_trusted_family_invites_claimed_by_idx
  on private.m2_trusted_family_invites (claimed_by)
  where claimed_by is not null;

create index if not exists m2_sos_events_actor_idx
  on private.m2_sos_events (actor_id);
