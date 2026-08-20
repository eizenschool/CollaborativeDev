import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

const hub = read('src/presentation/components/ride/RideHub.jsx');
const card = read('src/presentation/components/ride/RideCard.jsx');
const detail = read('src/presentation/components/ride/RideDetail.jsx');
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

  it('requires every accepted passenger for early start and labels the refreshed traffic ETA', () => {
    expect(requests).toContain("const allCheckedIn = accepted.length > 0 && checkedIn.length === accepted.length");
    expect(requests).toContain('All ${accepted.length} accepted passenger');
    expect(requests).toContain('Start trip early');
    expect(requests).toContain('will be marked No-show');
    expect(detail).toContain('Updated traffic ETA');
    expect(detail).toContain("journeyState.nextAction.id === RIDE_ACTION.START_RIDE");
    expect(detail).toContain('error, onLifecycle');
    expect(detail).toContain('Trip started. The traffic-aware ETA has been updated.');
  });
});
