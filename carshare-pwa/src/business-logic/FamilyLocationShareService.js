const functionUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
  ? `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/m2-live-share`
  : '';

async function post(body) {
  if (!functionUrl) throw new Error('Family location sharing is not configured.');
  const response = await fetch(functionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || 'This family link is invalid or expired.'), { status: response.status });
  }
  return data;
}

export const FamilyLocationShareService = {
  getSnapshot(token) { return post({ token }); },
  consumeMapLoad(token, pageSessionId) { return post({ action: 'map-permit', token, pageSessionId }); }
};
