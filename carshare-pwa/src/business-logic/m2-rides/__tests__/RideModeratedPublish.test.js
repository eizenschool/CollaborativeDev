import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invokeRoute: vi.fn(), check: vi.fn(), stage: vi.fn() }));
vi.mock('../../../data-access/m2-rides/rideSupabaseAdapter.js', () => ({ rideSupabaseAdapter: { isConfigured: true, invokeRoute: mocks.invokeRoute } }));
vi.mock('../RideContentService.js', () => ({ RideContentService: { check: mocks.check } }));
vi.mock('../RidePickupPhotoService.js', () => ({ RidePickupPhotoService: { stage: mocks.stage } }));
vi.mock('../../m1-profile/ReputationService.js', () => ({ ReputationService: { requireEligibility: vi.fn().mockResolvedValue(true) } }));
import { RideService } from '../RideService.js';

const current = () => ({ id:'ride', hostId:'host', status:'Published', vehicleId:'vehicle', seatsTotal:2,
  pickup:'A', destination:'B', pickupLocation:{ source:'google',placeId:'a' },destinationLocation:{source:'google',placeId:'b'},
  date:'2099-12-20',time:'12:00',journeyScale:'Urban',contribution:'Snacks',pickupInstructions:'Gate A',waypoints:[],restrictionTags:[] });
describe('moderated publish orchestration', () => {
  beforeEach(() => {
    vi.spyOn(RideService,'getRide').mockImplementation(async () => current());
    mocks.invokeRoute.mockReset().mockResolvedValue({ data:{rideId:'ride'} });
    mocks.check.mockReset().mockResolvedValue('receipt');
    mocks.stage.mockReset().mockResolvedValue('host/ride/photo.jpg');
  });
  afterEach(() => vi.restoreAllMocks());
  it('never persists when text checking is unavailable', async () => {
    mocks.check.mockRejectedValue(new Error('unavailable'));
    await expect(RideService.updateRide('ride',{contribution:'New',routeQuote:{token:'quote'}})).rejects.toThrow('unavailable');
    expect(mocks.invokeRoute).not.toHaveBeenCalled();
  });
  it('reports photo and text violations together when photo staging is rejected', async () => {
    mocks.stage.mockRejectedValue(Object.assign(new Error('Pickup photo: offensive gesture'), {
      fieldErrors: { pickupPhoto: 'Choose a photo without offensive gestures.' }
    }));
    mocks.check.mockRejectedValue(Object.assign(new Error('Contribution: illegal transaction. Pickup instructions: sexual content.'), {
      fieldErrors: {
        contribution: 'Remove offers or requests for illegal goods or services.',
        pickupInstructions: 'Remove sexual content.'
      }
    }));
    await expect(RideService.updateRide('ride',{routeQuote:{token:'quote'}},{file:{name:'photo'}})).rejects.toMatchObject({
      fieldErrors: {
        contribution: 'Remove offers or requests for illegal goods or services.',
        pickupInstructions: 'Remove sexual content.',
        pickupPhoto: 'Choose a photo without offensive gestures.'
      }
    });
    expect(mocks.check).toHaveBeenCalledWith('ride', expect.anything(), undefined);
    expect(mocks.invokeRoute).not.toHaveBeenCalled();
  });
  it('binds the staged photo and actual text to the approval sent with persistence', async () => {
    await RideService.updateRide('ride',{contribution:'Water',routeQuote:{token:'quote'}},{file:{name:'photo'}});
    expect(mocks.check).toHaveBeenCalledWith('ride',expect.objectContaining({contribution:'Water'}),'host/ride/photo.jpg');
    expect(mocks.invokeRoute).toHaveBeenCalledWith(expect.objectContaining({action:'publish',mode:'update',approvalId:'receipt',ride:expect.objectContaining({contribution:'Water'})}));
  });
  it('checks an existing retained photo instead of silently removing it', async () => {
    await RideService.updateRide('ride',{routeQuote:{token:'quote'}});
    expect(mocks.check).toHaveBeenCalledWith('ride',expect.anything(),undefined);
  });
  it('checks a draft before publishing, including explicit photo removal', async () => {
    RideService.getRide.mockResolvedValue({...current(),status:'Draft'});
    await RideService.publishDraft('ride',{pickupInstructions:'Gate B'},{token:'quote'},{remove:true});
    expect(mocks.check).toHaveBeenCalledWith('ride',expect.objectContaining({pickupInstructions:'Gate B'}),null);
    expect(mocks.invokeRoute).toHaveBeenCalledWith(expect.objectContaining({mode:'publish_draft',approvalId:'receipt'}));
  });
});
