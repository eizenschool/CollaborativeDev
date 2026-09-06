// Persisted values shared by Module 6's fixture and Supabase adapters.
// Business Logic re-exports these as domain constants; Data Access owns only
// their storage representation.
export const CATEGORY = Object.freeze({
  CULINARY: 'culinary',
  HERITAGE: 'heritage',
  NATURE: 'nature',
  EVENT: 'event',
});

export const PLACE_STATE = Object.freeze({
  PENDING_ENRICHMENT: 'Pending Enrichment',
  ACTIVE: 'Active',
  PROVISIONAL: 'Provisional',
  STALE: 'Stale',
  RETIRED: 'Retired',
});
