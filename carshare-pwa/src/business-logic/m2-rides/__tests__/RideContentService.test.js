import { beforeEach, describe, expect, it, vi } from 'vitest';
const check = vi.hoisted(() => vi.fn());
vi.mock('../../../data-access/m2-rides/rideContentSupabaseAdapter.js', () => ({ rideContentSupabaseAdapter: { isConfigured: true, check } }));
import { RideContentService } from '../RideContentService.js';
describe('RideContentService', () => {
  beforeEach(() => { check.mockReset(); });
  it('preserves per-field errors without showing provider text', async () => {
    check.mockResolvedValue({ data: { fields: { contribution: { status: 'rejected', reasons: ['threat'] } } } });
    await expect(RideContentService.check('ride', {})).rejects.toMatchObject({ fieldErrors: { contribution: 'Remove threats.' } });
  });
  it('keeps unavailable separate from rejected and never falls back', async () => {
    check.mockRejectedValue(new Error('network'));
    await expect(RideContentService.check('ride', {})).rejects.toMatchObject({ fieldErrors: { pickupInstructions: expect.stringContaining('temporarily unavailable') } });
    expect(check).toHaveBeenCalledTimes(1);
  });
  it('requires a server approval id even after an approved verdict', async () => {
    check.mockResolvedValue({ data: { fields: { contribution: { status: 'approved' } } } });
    await expect(RideContentService.check('ride', {})).rejects.toThrow();
  });
  it('passes explicit photo removal and only the two reviewed text fields', async () => {
    check.mockResolvedValue({ data: { approvalId: 'receipt', fields: {} } });
    expect(await RideContentService.check('ride', { contribution: 'Snacks', hostId: 'ignore' }, null)).toBe('receipt');
    expect(check).toHaveBeenCalledWith({ action: 'check', rideId: 'ride', text: { contribution: 'Snacks', pickupInstructions: '' }, photoPath: null });
  });
});
