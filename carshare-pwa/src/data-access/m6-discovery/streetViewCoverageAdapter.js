const configuredBaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const CHECK_PATH = 'functions/v1/m6-streetview';
const externalRequestsEnabled = !['fixture', 'test'].includes(import.meta.env?.MODE);

export async function fetchStreetViewCoverage(
  lat,
  lng,
  { baseUrl = configuredBaseUrl, fetchImpl } = {},
) {
  const request = fetchImpl || (externalRequestsEnabled ? globalThis.fetch : null);
  if (!baseUrl || typeof request !== 'function') return null;

  const base = baseUrl.replace(/\/$/, '');
  const response = await request(`${base}/${CHECK_PATH}?lat=${lat}&lng=${lng}`);
  if (!response?.ok) return null;
  return response.json();
}
