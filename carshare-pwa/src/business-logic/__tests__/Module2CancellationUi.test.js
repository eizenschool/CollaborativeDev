import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

const myRequests = read('src/presentation/components/ride/MyRequests.jsx');
const rideDetail = read('src/presentation/components/ride/RideDetail.jsx');
const rideStyles = read('src/presentation/styles/ride.css');

describe('Module 2 cancellation UX contract', () => {
  it('keeps cancellation reason rows full-width instead of applying close-button sizing', () => {
    expect(rideStyles).toContain('.round-icon-button, .sheet-title-row button {');
    expect(rideStyles).not.toContain('.bottom-sheet button:not(.danger-button)');
    expect(rideStyles).toContain('.reason-list button { width: 100%;');
  });

  it('explains that requester cancellation is immediate and gives a success notice', () => {
    expect(myRequests).toContain('Cancellation takes effect immediately.');
    expect(myRequests).toContain('does not need to approve this cancellation');
    expect(myRequests).toContain('Request cancelled immediately.');
  });

  it('does not label cancelled or historical requests as awaiting approval', () => {
    expect(rideDetail).toContain("activeRequest?.status === 'Pending'");
    expect(rideDetail).toContain('Request sent — awaiting Host approval');
    expect(rideDetail).toContain("activeRequest?.status === 'Cancelled'");
    expect(rideDetail).toContain('no Driver approval needed');
    expect(rideDetail).not.toContain("activeRequest.status === 'Accepted' ? 'Request accepted' : 'Request sent — awaiting approval'");
  });
});
