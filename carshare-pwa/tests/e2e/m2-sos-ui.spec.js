import { expect, test } from '@playwright/test';

const MOCK_STORAGE_KEY = 'letstumpang_mock_db_v1';

test.skip(process.env.VITE_M2_SOS_ENABLED !== 'true', 'SOS UI is release-gated and fixture mode keeps it off by default.');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('lets-tumpang-m2-sos-e2e-ready')) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('lets-tumpang-m2-sos-e2e-ready', 'true');
  });
});

test('trusted family routes preserve invitation privacy and mobile layout', async ({ page }) => {
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  await page.getByRole('button', { name: 'Info & Security' }).click();
  await expect(page.getByText('Trusted family', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create one-time invitation' })).toBeVisible();

  const token = 'A'.repeat(43);
  await page.goto(`/family/invite#token=${token}`);
  await expect(page.getByRole('heading', { name: 'Receive SOS alerts' })).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('m2-trusted-family-invite-token'))).toBe(token);

  await page.goto('/sos/00000000-0000-4000-8000-000000000001');
  await expect(page.getByRole('heading', { name: 'Loading SOS alert…' })).toBeVisible();
  await expect(page.locator('.family-location-hero')).toBeVisible();
  const familyHeroStyles = await page.locator('.family-location-hero').evaluate((hero) => ({
    radius: Number.parseFloat(getComputedStyle(hero).borderTopLeftRadius),
    display: getComputedStyle(hero).display,
  }));
  expect(familyHeroStyles.display).toBe('flex');
  expect(familyHeroStyles.radius).toBeGreaterThanOrEqual(18);
  await expect(page.getByRole('alert')).toContainText('configured Supabase');

  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});

test('Trip Mode presents a responsive control overview and compact safety support', async ({ page }) => {
  test.skip(process.env.VITE_M2_LIVE_TRACKING_ENABLED !== 'true', 'The combined safety hub needs both release flags enabled.');

  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Hi, Jamie', exact: true })).toBeVisible();
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    const departure = new Date(Date.now() + (30 * 60 * 1000));
    Object.assign(database.rides.r_5, {
      status: 'Matched',
      date: departure.toLocaleDateString('en-CA'),
      time: departure.toTimeString().slice(0, 5),
      departureAt: departure.toISOString(),
      expiredAt: null,
    });
    Object.assign(database.rideRequests.rq_2, {
      status: 'Accepted',
      boardingStatus: 'Checked In',
      checkedInAt: new Date().toISOString(),
    });
    database.rideRequests.rq_1.status = 'Rejected';
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);

  await page.goto('/ride/r_5?view=trip');
  await expect(page.locator('.trip-command-card .ride-status-badge')).toHaveText('Matched');
  await expect(page.getByRole('heading', { name: 'Safety & live sharing' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Get help from trusted family' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your sharing is off' })).toBeVisible();

  const viewportWidth = page.viewportSize()?.width || 0;
  const overviewColumns = await page.locator('.trip-overview-grid').evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
  ));
  expect(overviewColumns).toBe(viewportWidth > 1100 ? 2 : 1);
  const overviewLayout = await page.locator('.trip-overview-grid').evaluate((element) => {
    const command = element.querySelector('.trip-overview-command').getBoundingClientRect();
    const route = element.querySelector('.trip-overview-route').getBoundingClientRect();
    return { commandTop: Math.round(command.top), commandLeft: Math.round(command.left), routeTop: Math.round(route.top), routeLeft: Math.round(route.left) };
  });
  if (viewportWidth > 1100) {
    expect(Math.abs(overviewLayout.commandTop - overviewLayout.routeTop)).toBeLessThanOrEqual(1);
    expect(overviewLayout.routeLeft).toBeLessThan(overviewLayout.commandLeft);
  } else {
    expect(overviewLayout.commandTop).toBeLessThan(overviewLayout.routeTop);
  }

  const supportColumns = await page.locator('.trip-support-grid').evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
  ));
  expect(supportColumns).toBe(viewportWidth > 1100 ? 2 : 1);
  const safetyColumns = await page.locator('.trip-safety-grid').evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
  ));
  expect(safetyColumns).toBe(viewportWidth > 900 ? 2 : 1);

  const secondaryActions = page.locator('.trip-mode-actions > .outline-action');
  await expect(secondaryActions).toHaveCount(2);
  await expect(page.locator('.trip-mode-actions')).toHaveCSS('position', 'static');
  const actionLayout = await secondaryActions.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { top: Math.round(box.top), height: Math.round(box.height) };
  }));
  expect(actionLayout[0].top).toBe(actionLayout[1].top);
  expect(actionLayout.every(({ height }) => height >= 44)).toBe(true);

  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});
