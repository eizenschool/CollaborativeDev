import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

describe('Friend-chat Ride invitation UI contract', () => {
  it('shows the picker only in Friend chat and preserves optional note drafts', () => {
    const chat = read('src/presentation/components/messaging/ChatWindow.jsx');
    expect(chat).toContain("conversation.scope === 'friend'");
    expect(chat).toContain('openRidePicker');
    expect(chat).toContain('rideInvitation,');
    expect(chat).toContain('MessagingService.sendRideInvitation');
    expect(chat).toContain("'Add a message (optional)'");
    expect(chat).toContain('ref={ridePickerRef}');
  });

  it('renders current Ride state and routes the recipient through Ride Detail', () => {
    const card = read('src/presentation/components/messaging/RideInvitationCard.jsx');
    expect(card).toContain('invitation.rideStatus');
    expect(card).toContain('invitation.seatsAvailable');
    expect(card).toContain('invitation.requestStatus');
    expect(card).toContain('to={`/ride/${invitation.rideId}`}');
    expect(card).toContain('View Ride');
    expect(card).not.toContain('requestRide');
  });

  it('distinguishes Host and passenger-shareable Ride options', () => {
    const chat = read('src/presentation/components/messaging/ChatWindow.jsx');
    expect(chat).toContain("option.sourceRole === 'host' ? 'Your hosted Ride' : 'Your requested or joined Ride'");
  });

  it('offers both Search and Publish when no Ride can be shared', () => {
    const chat = read('src/presentation/components/messaging/ChatWindow.jsx');
    expect(chat).toContain('<Link to="/search">Search Rides</Link>');
    expect(chat).toContain('<Link to="/ride/publish">Publish a Ride</Link>');
  });
});
