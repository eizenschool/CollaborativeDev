-- Cover the two profile foreign keys introduced by the Role Admin audit table.
create index if not exists m2_dispute_admin_audit_actor_idx
  on private.m2_dispute_admin_audit (actor_id, created_at desc);
create index if not exists m2_dispute_admin_audit_subject_idx
  on private.m2_dispute_admin_audit (subject_id, created_at desc);
