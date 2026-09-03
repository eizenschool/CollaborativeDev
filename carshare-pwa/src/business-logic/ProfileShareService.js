export function buildPublicProfileUrl(userId, origin = globalThis.location?.origin || '') {
  if (!userId) throw new Error('A member profile is required.');
  return `${String(origin).replace(/\/$/, '')}/users/${encodeURIComponent(userId)}`;
}

function legacyCopy(text, documentObject) {
  if (!documentObject?.body || typeof documentObject.execCommand !== 'function') return false;
  const input = documentObject.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  documentObject.body.appendChild(input);
  input.select();
  const copied = documentObject.execCommand('copy');
  input.remove();
  return copied;
}

export async function sharePublicProfile({
  userId,
  displayName = 'my',
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document,
  origin = globalThis.location?.origin || '',
}) {
  const url = buildPublicProfileUrl(userId, origin);
  const shareData = {
    title: `${displayName} · Let's Tumpang`,
    text: `View ${displayName}'s public profile on Let's Tumpang.`,
    url,
  };

  if (typeof navigatorObject?.share === 'function') {
    try {
      await navigatorObject.share(shareData);
      return { method: 'shared', url };
    } catch (error) {
      if (error?.name === 'AbortError') return { method: 'cancelled', url };
    }
  }

  try {
    if (typeof navigatorObject?.clipboard?.writeText === 'function') {
      await navigatorObject.clipboard.writeText(url);
      return { method: 'copied', url };
    }
  } catch {
    // Older browsers may expose Clipboard but reject it outside a secure context.
  }

  if (legacyCopy(url, documentObject)) return { method: 'copied', url };
  throw new Error('Unable to share or copy the profile link on this device.');
}
