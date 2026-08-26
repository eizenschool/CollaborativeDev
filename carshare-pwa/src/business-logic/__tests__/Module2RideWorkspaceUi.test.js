import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

const hub = read('src/presentation/components/ride/RideHub.jsx');
const card = read('src/presentation/components/ride/RideCard.jsx');
const detail = read('src/presentation/components/ride/RideDetail.jsx');
const publish = read('src/presentation/components/ride/PublishRide.jsx');
const requests = read('src/presentation/components/ride/ManageRequests.jsx');
const styles = read('src/presentation/styles/ride.css');

describe('Module 2 ride workspace UI contract', () => {
  it('groups the unified workspace by user attention instead of one mixed list', () => {
    expect(hub).toContain('ride-workspace-header');
    expect(hub).not.toContain('ride-management-card');
    expect(hub).toContain('journeyGroup(item.state)');
    expect(hub).toContain('groupKey="attention"');
    expect(hub).toContain('groupKey="upcoming"');
    expect(hub).toContain('groupKey="drafts"');
    expect(hub).toContain('groupKey="history"');
    expect(hub).toContain('collapsible');
  });

  it('uses a compact card for the workspace while retaining the full card contract elsewhere', () => {
    expect(hub).toContain('journeyState={item.state} compact');
    expect(card).toContain('compact = false');
    expect(card).toContain('compact ? journeyState.nextAction.label : journeyState.title');
    expect(card).toContain('!compact && ride.estimatedArrivalAt');
    expect(card).toContain('!compact && ride.restrictionTags?.length');
  });

  it('constrains desktop primary actions and collapses history', () => {
    expect(styles).toContain('.ride-next-action .btn-primary {');
    expect(styles).toContain('max-width: 190px;');
    expect(styles).toContain('.ride-history-group[open] > summary');
  });

  it('offers terminal Driver history as a new editable Draft', () => {
    expect(hub).not.toContain('ride-history-republish');
    expect(hub).toContain('HISTORY_PHASES.has(item.state.phase) ? `/ride/${item.ride.id}`');
    expect(detail).toContain("['Completed', 'Cancelled', 'Expired'].includes(ride.status)");
    expect(detail).toContain('RideService.republishAsDraft(ride.id)');
    expect(detail).toContain('Publish again');
    expect(detail).toContain('Creating draft');
    expect(detail).toContain('`/ride/${draft.id}/publish`');
    expect(styles).toContain('.ride-detail-republish');
    expect(styles).toMatch(/\.ride-bottom-actions \{[^}]*display: grid;[^}]*gap: 12px;/);
    expect(publish).toContain('New Draft created from your Ride history.');
    expect(publish).toContain("previous Ride's pickup photo was not copied");
  });

  it('opens Completed History in Ride Detail before exposing its review', () => {
    expect(hub).toContain('const historyPath = HISTORY_PHASES.has(item.state.phase)');
    expect(detail).toContain("ride.status === 'Completed' && <button");
    expect(detail).toContain('journeyState.nextAction.label');
    expect(detail.indexOf("ride.status === 'Completed' && <button")).toBeLessThan(detail.indexOf('className="ride-detail-republish"'));
  });

  it('keeps day-of execution in Trip Mode and labels the refreshed traffic ETA', () => {
    expect(requests).toContain('Check-in, No-show and Start are handled in Trip Mode.');
    expect(requests).toContain('Open Trip Mode');
    expect(requests).not.toContain('async function startRide');
    expect(requests).not.toContain('async function markNoShow');
    expect(detail).toContain('Updated traffic ETA');
    expect(detail).toContain("journeyState.nextAction.id === RIDE_ACTION.START_RIDE");
    expect(detail).toContain('error, clock, onLifecycle');
    expect(detail).toContain('TRIP LIFECYCLE');
    expect(detail).toContain('Trip started. The traffic-aware ETA has been updated.');
  });
});
