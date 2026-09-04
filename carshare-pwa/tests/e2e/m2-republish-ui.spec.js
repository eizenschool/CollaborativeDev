import { expect, test } from '@playwright/test';

const MOCK_STORAGE_KEY = 'letstumpang_mock_db_v1';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('m2-republish-e2e-ready')) return;
    localStorage.clear();
    sessionStorage.setItem('m2-republish-e2e-ready', 'true');
  });
});

test('Driver republishes an expired History ride into a separate editable Draft', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Where should you go?' })).toBeVisible();
  await page.goto('/ride');
  await expect(page.getByRole('heading', { name: 'My rides' })).toBeVisible();

  const history = page.locator('.ride-history-group');
  await history.locator('summary').click();
  await expect(history.getByRole('button', { name: 'Publish again' })).toHaveCount(0);
  const expiredDriverRide = history.locator('.ride-journey-card-wrap').filter({ hasText: 'Driver' }).filter({ hasText: 'Expired' });
  await expiredDriverRide.getByRole('button', { name: /Open ride from/i }).click();

  await expect(page).toHaveURL(/\/ride\/r_5$/);
  await page.getByRole('button', { name: 'Publish again' }).click();

  await expect(page).toHaveURL(/\/ride\/r_[^/]+\/publish$/);
  await expect(page.getByText('New Draft created from your Ride history.', { exact: false })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Pickup point', exact: true })).toHaveValue('Bangsar LRT, Kuala Lumpur');
  await expect(page.getByRole('combobox', { name: 'Destination', exact: true })).toHaveValue('Cyberjaya, Selangor');

  const result = await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    const newRideId = location.pathname.split('/')[2];
    return {
      oldStatus: database.rides.r_5.status,
      newRideId,
      newRide: database.rides[newRideId],
    };
  }, MOCK_STORAGE_KEY);

  expect(result.oldStatus).toBe('Expired');
  expect(result.newRideId).not.toBe('r_5');
  expect(result.newRide).toMatchObject({
    status: 'Draft',
    pickup: 'Bangsar LRT, Kuala Lumpur',
    destination: 'Cyberjaya, Selangor',
    pickupPhotoPath: null,
    estimatedArrivalAt: null,
  });
});

test('Completed History opens Ride Detail and reveals review only on request', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Where should you go?' })).toBeVisible();
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    Object.assign(database.rides.r_5, {
      status: 'Completed',
      completedAt: '2026-08-20T03:00:00.000Z',
      expiredAt: null,
    });
    Object.assign(database.rideRequests.rq_2, {
      status: 'Accepted',
      acceptedAt: '2026-08-11T03:00:00.000Z',
      decisionReason: null,
      cancelledBy: null,
    });
    database.rideReviews.review_r5_host = {
      id: 'review_r5_host',
      rideId: 'r_5',
      reviewerId: 'u_demo_1',
      revieweeId: 'u_host_sarah',
      rating: 5,
      comment: 'Reliable passenger.',
      createdAt: '2026-08-20T04:00:00.000Z',
    };
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);

  await page.goto('/ride');
  const history = page.locator('.ride-history-group');
  await history.locator('summary').click();
  const completedDriverRide = history.locator('.ride-journey-card-wrap').filter({ hasText: 'Bangsar LRT, Kuala Lumpur' }).filter({ hasText: 'Completed' });
  await completedDriverRide.getByRole('button', { name: /Open ride from/i }).click();

  await expect(page).toHaveURL(/\/ride\/r_5$/);
  await expect(page.getByRole('heading', { name: 'Rate & review' })).toHaveCount(0);
  const actions = page.locator('.ride-bottom-actions');
  await expect(actions.getByRole('button', { name: 'View your review' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Publish again' })).toBeVisible();
  expect(await actions.evaluate((element) => getComputedStyle(element).rowGap)).toBe('12px');
  const labels = (await actions.getByRole('button').allTextContents()).map((label) => label.trim());
  expect(labels.indexOf('View your review')).toBeLessThan(labels.indexOf('Publish again'));

  await actions.getByRole('button', { name: 'View your review' }).click();
  await expect(page).toHaveURL(/\/ride\/r_5\/review$/);
  await expect(page.getByRole('heading', { name: 'Rate & review' })).toBeVisible();
  await expect(page.getByText('YOUR REVIEW')).toBeVisible();
});
