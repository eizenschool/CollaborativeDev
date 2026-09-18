import { expect, test } from '@playwright/test';
const storageKey = 'letstumpang_mock_db_v1';

async function prepare(page, status) {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Where should you go?', exact: true })).toBeVisible();
  await page.evaluate(({ storageKey, status }) => {
    const db = JSON.parse(localStorage.getItem(storageKey));
    db.identityVerifications ||= {};
    db.identityVerifications.u_demo_1 = { status: 'pending', document_path: 'u_demo_1/test', document_name: 'test.png', ic_number: '990101145678', license_document_path: 'u_demo_1/licence.mock', license_expiry: '2099-12-31', submitted_at: new Date().toISOString() };
    const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0,10);
    Object.assign(db.rides.r_5, { status, hostId: 'u_demo_1', date, time: '12:00', departureAt: `${date}T04:00:00.000Z`,
      contribution: 'Snacks', pickupInstructions: 'Gate A', expiredAt: null, seatsAvailable: 3, seatsTotal: 3,
      pickupLocation: { source:'google', placeId:'pickup-fixture' }, destinationLocation: { source:'google', placeId:'fixture_jonker' },
      waypoints: [], pickupPhotoPath: null, hasPickupPhoto: false });
    Object.values(db.rideRequests).forEach((r) => { if (r.rideId === 'r_5') delete db.rideRequests[r.id]; });
    Object.values(db.rides).forEach((r) => { if (r.id !== 'r_5' && r.hostId === 'u_demo_1') r.status = 'Completed'; });
    localStorage.setItem(storageKey, JSON.stringify(db));
  }, { storageKey, status });
}

test('Published edit retains input, reports field rejection and succeeds on retry', async ({ page }) => {
  await prepare(page, 'Published');
  await page.goto('/ride/r_5/edit');
  await expect(page.getByRole('heading', { name:'Edit ride' })).toBeVisible();
  await page.evaluate(async () => {
    const { RideService } = await import('/src/business-logic/m2-rides/RideService.js');
    RideService.quoteRide = async () => ({ token:'fixture', expiresAt:new Date(Date.now()+240000).toISOString(), estimatedArrivalAt:new Date(Date.now()+7*86400000+3600000).toISOString(), distanceMeters:1000, routeDurationSeconds:600 });
    const original = RideService.updateRide.bind(RideService);
    let attempts = 0;
    RideService.updateRide = async (...args) => {
      if (attempts++ === 0) throw Object.assign(new Error('Contribution: Remove private contact details.'), { fieldErrors: { contribution:'Remove private contact details.' } });
      return original(...args);
    };
  });
  await page.locator('#contribution').fill('Email person@example.com');
  await page.getByRole('button', { name:'Save changes', exact:true }).click();
  await expect(page.locator('#edit-contribution-error')).toContainText('Remove private');
  await expect(page.locator('#contribution')).toHaveValue('Email person@example.com');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).rides.r_5.contribution, storageKey)).toBe('Snacks');
  await page.screenshot({ path: `test-results/m2-edit-${test.info().project.name}.png`, fullPage: true });
  await page.locator('#contribution').fill('Bring snacks');
  await page.getByRole('button', { name:'Save changes', exact:true }).click();
  await expect(page).toHaveURL(/\/ride\/r_5$/);
});

test('Draft publish returns to the rejected field and preserves input when check is unavailable', async ({ page }) => {
  await prepare(page, 'Draft');
  await page.goto('/ride/r_5/publish');
  await expect(page.getByRole('heading', { name:'Route', exact:true }).first()).toBeVisible();
  await page.evaluate(async () => {
    const { RideService } = await import('/src/business-logic/m2-rides/RideService.js');
    RideService.quoteRide = async () => ({ token:'fixture', expiresAt:new Date(Date.now()+240000).toISOString(), estimatedArrivalAt:new Date(Date.now()+7*86400000+3600000).toISOString(), distanceMeters:1000, routeDurationSeconds:600 });
    RideService.publishDraft = async () => { throw Object.assign(new Error('Content checking is temporarily unavailable. Please retry.'), { fieldErrors: { pickupInstructions:'Content checking is temporarily unavailable. Your input is kept. Please retry.' } }); };
  });
  await page.locator('.step-item').filter({ hasText:'Trip Details' }).evaluate((el) => el.click());
  await page.locator('#pickup-instructions').fill('Wait at Gate B');
  await page.locator('.step-item').filter({ hasText:'Review & Publish' }).evaluate((el) => el.click());
  await page.getByRole('button', { name:/^Publish ride$/i }).click();
  await expect(page.locator('#pickup-instructions-error')).toContainText('temporarily unavailable');
  await expect(page.locator('#pickup-instructions')).toHaveValue('Wait at Gate B');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).rides.r_5.status, storageKey)).toBe('Draft');
  await page.screenshot({ path: `test-results/m2-publish-${test.info().project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('remaining photo error does not steal focus while correcting text', async ({ page }) => {
  await prepare(page, 'Draft');
  await page.goto('/ride/r_5/publish');
  await expect(page.getByRole('heading', { name:'Route', exact:true }).first()).toBeVisible();
  await page.evaluate(async () => {
    const { RideService } = await import('/src/business-logic/m2-rides/RideService.js');
    RideService.quoteRide = async () => ({ token:'fixture', expiresAt:new Date(Date.now()+240000).toISOString(), estimatedArrivalAt:new Date(Date.now()+7*86400000+3600000).toISOString(), distanceMeters:1000, routeDurationSeconds:600 });
    RideService.publishDraft = async () => { throw Object.assign(new Error('Pickup photo: Choose a photo without offensive gestures.'), { fieldErrors: { pickupPhoto:'Choose a photo without offensive gestures.' } }); };
  });
  await page.locator('.step-item').filter({ hasText:'Review & Publish' }).evaluate((el) => el.click());
  await page.getByRole('button', { name:/^Publish ride$/i }).click();
  await expect(page.locator('#pickup-photo-content-error')).toBeVisible();
  const contribution = page.locator('#ride-contribution');
  await contribution.click();
  await contribution.press('H');
  await expect(contribution).toBeFocused();
  await contribution.press('e');
  await expect(contribution).toBeFocused();
  await expect(contribution).toHaveValue('SnacksHe');
});
