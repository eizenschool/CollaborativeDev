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

async function dispatchTouch(page, selector, start, end) {
  await page.locator(selector).first().evaluate((element, points) => {
    const emit = (type, touches, changedTouches = touches) => {
      const eventValue = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(eventValue, {
        touches: { value: touches },
        changedTouches: { value: changedTouches },
      });
      element.dispatchEvent(eventValue);
    };
    const touch = (point) => ({
      identifier: 1,
      target: element,
      clientX: point.x,
      clientY: point.y,
    });
    emit('touchstart', [touch(points.start)]);
    emit('touchmove', [touch(points.end)]);
    emit('touchend', [], [touch(points.end)]);
  }, { start, end });
}

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
  await expect(page.getByRole('heading', { name: 'Where should you go?', exact: true })).toBeVisible();
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
  await expect(page.getByText('Family Link', { exact: true })).toBeVisible();
  await expect(page.getByText('Accepted passengers create their own private link.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create family link' })).toHaveCount(0);

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

test('eligible rides expose a global confirmed SOS launcher outside Trip Mode', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Where should you go?', exact: true })).toBeVisible();
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

  await page.goto('/home');
  const viewportWidth = page.viewportSize()?.width || 0;
  const launcher = page.getByRole('button', { name: /Open emergency SOS/ });
  await expect(launcher).toBeVisible();
  const launcherBox = await launcher.boundingBox();
  expect(launcherBox?.height || 0).toBeGreaterThanOrEqual(viewportWidth <= 700 ? 56 : 44);
  expect(launcherBox?.x || 0).toBeGreaterThanOrEqual(0);

  if (viewportWidth <= 700) {
    await expect(page.locator('.global-sos-launcher')).toHaveClass(/dock-right/);
    await expect(launcher).toHaveClass(/is-compact/);
    await dispatchTouch(page, '.global-sos-button', { x: 310, y: 420 }, { x: 60, y: 420 });
    await expect(page).toHaveURL(/\/home$/);
    const beforeDrag = await launcher.boundingBox();
    await page.mouse.move(beforeDrag.x + 28, beforeDrag.y + 28);
    await page.mouse.down();
    await page.mouse.move(32, Math.max(120, beforeDrag.y - 100), { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.global-sos-launcher')).toHaveClass(/dock-left/);
    const afterDrag = await launcher.boundingBox();
    expect(afterDrag.y).toBeLessThan(beforeDrag.y);
    await expect.poll(() => page.evaluate(() => [...Array(localStorage.length).keys()]
      .map((index) => localStorage.key(index))
      .filter((key) => key?.startsWith('m2-sos-launcher-position:'))
      .map((key) => JSON.parse(localStorage.getItem(key))))).toContainEqual(expect.objectContaining({ side: 'left' }));
  } else {
    await expect(page.locator('.topnav-actions').getByRole('button', { name: 'Open emergency SOS' })).toBeVisible();
    await expect(page.locator('.global-sos-launcher')).toBeHidden();
    await expect(page.locator('.topnav-links .topnav-item')).toHaveCount(7);
  }

  await launcher.click();
  await expect(page.getByRole('heading', { name: 'Activate SOS?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate SOS now' })).toBeVisible();
  if (viewportWidth <= 700) {
    await expect(page.getByRole('button', { name: 'Move SOS up' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move SOS down' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset SOS position' })).toBeVisible();
    await page.getByRole('button', { name: 'Move SOS to right side' }).click();
    await expect(page.locator('.global-sos-launcher')).toHaveClass(/dock-right/);
  }
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/search');
  await expect(page.getByRole('button', { name: /Open emergency SOS/ })).toBeVisible();
  if (viewportWidth <= 700) {
    await expect(page.getByRole('button', { name: /Open emergency SOS/ })).toHaveClass(/is-compact/);
    await expect(page.locator('.global-sos-launcher')).toHaveClass(/dock-right/);
  }

  await page.goto('/ride/r_5?view=trip');
  await expect(page.getByRole('button', { name: /Open emergency SOS/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hold for SOS' })).toBeVisible();

  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});

test('accepted Passenger keeps the Family Link creation action in Trip Mode', async ({ page }) => {
  test.skip(process.env.VITE_M2_LIVE_TRACKING_ENABLED !== 'true', 'Family Link is release-gated with live tracking.');

  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Where should you go?', exact: true })).toBeVisible();
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
      boardingStatus: 'Pending',
      checkedInAt: null,
    });
    database.currentUserId = 'u_host_sarah';
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);

  await page.goto('/ride/r_5?view=trip');
  await expect(page.getByText('Family Link', { exact: true })).toBeVisible();
  await expect(page.getByText('Create a private, trip-only link', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create family link' })).toBeVisible();

  const buttonBox = await page.getByRole('button', { name: 'Create family link' }).boundingBox();
  expect(buttonBox?.height || 0).toBeGreaterThanOrEqual(44);
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});
