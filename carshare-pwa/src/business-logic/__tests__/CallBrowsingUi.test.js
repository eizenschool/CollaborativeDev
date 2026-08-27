import { describe, expect, it } from 'vitest';

async function read(relativeUrl) {
  return import('node:fs/promises').then(({ readFile }) => readFile(
    new URL(relativeUrl, import.meta.url),
    'utf8',
  ));
}

describe('voice-call browsing UI', () => {
  it('keeps outgoing and connected calls minimizable', async () => {
    const context = await read('../../context/CallSessionContext.jsx');
    expect(context).toContain("['outgoing', 'connecting', 'connected', 'reconnecting']");
    expect(context).toContain('isMinimized: true');
  });

  it('provides chat, ride, trip, and profile navigation while the call remains global', async () => {
    const overlay = await read('../../presentation/components/messaging/CallOverlay.jsx');
    expect(overlay).toContain('View while calling');
    expect(overlay).toContain('path: `/message/${callState.call.conversationId}`');
    expect(overlay).toContain("path: rideId ? `/ride/${rideId}` : '/ride'");
    expect(overlay).toContain("{ key: 'trips', label: 'Trips', path: '/trip'");
    expect(overlay).toContain('Browse during call');
    expect(overlay).toContain('minimizeCall();');
    expect(overlay).toContain('navigate(path);');
  });
});
