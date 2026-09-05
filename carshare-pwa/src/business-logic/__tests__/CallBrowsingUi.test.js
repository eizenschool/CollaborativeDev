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

  it('uses one icon to minimize every call without a dedicated browse menu', async () => {
    const overlay = await read('../../presentation/components/messaging/CallOverlay.jsx');
    expect(overlay).not.toContain('View while calling');
    expect(overlay).not.toContain('Browse during call');
    expect(overlay).toContain('onClick={minimizeCall}');
    expect(overlay).toContain('<IconMinus size={20}');
    expect(overlay).toContain("'Group voice call'");
    expect(overlay).toContain('remoteStreams.map');
  });

  it('shows every invited group participant with connection and speaking states', async () => {
    const overlay = await read('../../presentation/components/messaging/CallOverlay.jsx');
    const styles = await read('../../presentation/styles/call.css');
    expect(overlay).not.toContain('visibleParticipants.slice');
    expect(overlay).toContain('visibleParticipants.map');
    expect(overlay).toContain('speakingUserIds');
    expect(overlay).toContain("participant?.status === 'accepted'");
    expect(styles).toContain('overflow-x: auto');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('opens a group-member picker and calls only selected members', async () => {
    const chatWindow = await read('../../presentation/components/messaging/ChatWindow.jsx');
    expect(chatWindow).toContain('Choose people to call');
    expect(chatWindow).toContain('Only selected people will receive the call.');
    expect(chatWindow).toContain('beginVoiceCall(selectedCallMemberIds)');
    expect(chatWindow).toContain('member.id !== currentUser.id');
  });

  it('keeps each unanswered invitee ringing after another group member answers', async () => {
    const context = await read('../../context/CallSessionContext.jsx');
    expect(context).toContain('if (isCurrentCallParticipantAccepted(call))');
    expect(context).not.toContain(
      'call.sessionStatus === CALL_STATUS.ACCEPTED || call.status === CALL_STATUS.ACCEPTED',
    );
  });
});
