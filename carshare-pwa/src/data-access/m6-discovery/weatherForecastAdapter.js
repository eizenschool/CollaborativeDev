// Open-Meteo transport for Module 6. Fixture and test builds stay offline unless
// a test explicitly injects a fetch implementation.
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const externalRequestsEnabled = !['fixture', 'test'].includes(import.meta.env?.MODE);

export async function fetchWeatherForecastRows(places, travelDate, { fetchImpl } = {}) {
  const request = fetchImpl || (externalRequestsEnabled ? globalThis.fetch : null);
  if (!places?.length || !travelDate || typeof request !== 'function') return [];

  const url = `${OPEN_METEO_URL}`
    + `?latitude=${places.map((place) => place.lat).join(',')}`
    + `&longitude=${places.map((place) => place.lng).join(',')}`
    + `&daily=weather_code&start_date=${travelDate}&end_date=${travelDate}`
    + `&timezone=Asia%2FKuala_Lumpur`;

  const response = await request(url);
  if (!response?.ok) return [];

  const body = await response.json();
  const entries = Array.isArray(body) ? body : [body];
  return places.map((place, index) => ({
    placeId: place.id,
    weatherCode: entries[index]?.daily?.weather_code?.[0],
  }));
}
