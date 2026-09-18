import { expect, test } from '@playwright/test';

const MOCK_STORAGE_KEY = 'letstumpang_mock_db_v1';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('lets-tumpang-e2e-ready')) return;
    localStorage.clear();
    sessionStorage.setItem('lets-tumpang-e2e-ready', 'true');
  });
});

test('a passenger can cancel an active request from Ride Detail', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Where should you go?', exact: true })).toBeVisible();
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    Object.assign(database.rides.r_1, {
      date: '2030-08-28',
      time: '15:00',
      departureAt: '2030-08-28T07:00:00.000Z',
      status: 'Published',
      expiredAt: null,
    });
    Object.assign(database.rideRequests.rq_3, {
      status: 'Accepted',
      decisionReason: null,
      cancelledAt: null,
      cancelledBy: null,
    });
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);

  await page.goto('/ride/r_1');
  await expect(page.getByText('Request accepted', { exact: true })).toBeVisible();
  const actionLayout = await page.locator('.ride-bottom-actions').evaluate((rail) => {
    const items = [...rail.children].map((item) => item.getBoundingClientRect());
    return {
      widths: items.map((item) => Math.round(item.width)),
      heights: items.map((item) => Math.round(item.height)),
      gaps: items.slice(1).map((item, index) => Math.round(item.top - items[index].bottom)),
    };
  });
  expect(new Set(actionLayout.widths).size).toBe(1);
  expect(new Set(actionLayout.heights).size).toBe(1);
  expect(actionLayout.gaps).toEqual([12, 12]);
  await page.getByRole('button', { name: 'Cancel request', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Cancel this request?' });
  await expect(dialog).toContainText('does not need to approve it');
  await dialog.getByRole('button', { name: 'Change of plans' }).click();
  await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();

  await expect(page.getByRole('status')).toContainText('Request cancelled immediately');
  await expect(page.getByText('Request cancelled — no Driver approval needed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toHaveCount(0);
});
