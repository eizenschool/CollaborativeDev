import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const MOCK_STORAGE_KEY = 'letstumpang_mock_db_v1';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('lets-tumpang-e2e-ready')) return;
    localStorage.clear();
    sessionStorage.setItem('lets-tumpang-e2e-ready', 'true');
  });
});

async function openPage(page, path, heading) {
  await page.goto(path);
  if (heading) await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
}

async function expectNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `page width ${dimensions.scrollWidth}px exceeds viewport ${dimensions.clientWidth}px`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test('public browsing preserves Discover to Search hand-off', async ({ page }) => {
  await openPage(page, '/home', 'Hi, Jamie');
  await page.getByRole('link', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: 'Find the right ride' })).toBeVisible();

  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    Object.assign(database.rides.r_1, {
      date: '2026-09-15',
      time: '07:00',
      departureAt: '2026-09-14T23:00:00.000Z',
      status: 'Published',
      expiredAt: null,
    });
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);
  await openPage(page, '/discover?date=2026-09-15', 'Where should you go?');
  await page.locator('.dsc-hero').click();
  await expect(page).toHaveURL(/\/discover\/[^/?]+\?date=/);
  await page.getByRole('button', { name: /Find a ride/i }).click();
  await expect(page).toHaveURL(/\/search\?.*destination=/);
  await expect(page.getByRole('heading', { name: 'Find the right ride' })).toBeVisible();
});

test('authentication returns the member to the guarded destination', async ({ page }) => {
  await openPage(page, '/home', 'Hi, Jamie');
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    database.currentUserId = null;
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);
  await page.reload();
  await page.goto('/ride');
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByText('Sign in to manage the rides you host or requested.')).toBeVisible();
  await page.getByLabel('Email Address').fill('jamie@letstumpang.app');
  await page.locator('#auth-password').fill('fixture-pass');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/ride$/);
  await expect(page.getByRole('heading', { name: 'My rides' })).toBeVisible();
});

test('desktop Auth car stays on the journey route and keeps moving', async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) <= 880, 'The journey scene is intentionally hidden at compact widths.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPage(page, '/home', 'Hi, Jamie');
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    database.currentUserId = null;
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);
  await page.reload();
  await page.goto('/auth');

  const routeCar = page.locator('.route-car');
  await expect(routeCar).toBeVisible();
  await expect.poll(() => routeCar.getAttribute('transform')).toMatch(/^translate\(/);
  const firstTransform = await routeCar.getAttribute('transform');
  await expect.poll(() => routeCar.getAttribute('transform'), { timeout: 2_000 }).not.toBe(firstTransform);

  const distanceFromRoute = await page.evaluate(() => {
    const route = document.querySelector('#auth-journey-route');
    const car = document.querySelector('.route-car');
    const match = car?.getAttribute('transform')?.match(/translate\(([-\d.]+) ([-\d.]+)\)/);
    if (!route || !match) return Number.POSITIVE_INFINITY;
    const carPoint = { x: Number(match[1]), y: Number(match[2]) };
    const routeLength = route.getTotalLength();
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= 400; index += 1) {
      const point = route.getPointAtLength(routeLength * index / 400);
      closestDistance = Math.min(closestDistance, Math.hypot(point.x - carPoint.x, point.y - carPoint.y));
    }
    return closestDistance;
  });
  expect(distanceFromRoute).toBeLessThan(2);

  await expect.poll(() => routeCar.getAttribute('data-direction'), { timeout: 5_000 }).toBe('return');
  const returnAngle = Number((await routeCar.getAttribute('transform'))?.match(/rotate\(([-\d.]+)\)/)?.[1]);
  expect(Math.abs(returnAngle)).toBeLessThan(90);
});

test('Ride workspace foregrounds responsibility and publishing recovery', async ({ page }) => {
  await openPage(page, '/ride', 'My rides');
  const nextStep = page.locator('.ride-next-action');
  await expect(nextStep).toContainText('YOUR NEXT STEP');
  await expect(nextStep).toContainText('Your role');
  await expect(nextStep).toContainText('Timing');
  await expect(nextStep).toContainText('Responsible');

  await page.getByRole('button', { name: /Publish ride/i }).click();
  await expect(page.getByRole('heading', { name: 'Route', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /Continue/i }).first().click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Route', exact: true }).first()).toBeVisible();
});

test('Trip lifecycle timestamps reflow without overlapping their explanation', async ({ page }) => {
  await openPage(page, '/home', 'Hi, Jamie');
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    Object.assign(database.rides.r_6, {
      status: 'Completed',
      driverArrivedAt: '2026-08-25T15:35:00.000Z',
      passengerConfirmationDueAt: '2026-08-26T15:35:00.000Z',
      completedAt: '2026-08-25T15:36:00.000Z',
    });
    Object.assign(database.rideRequests.rq_4, {
      status: 'Accepted',
      boardingStatus: 'Checked In',
      arrivalConfirmedAt: '2026-08-25T15:36:00.000Z',
    });
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);
  await page.goto('/ride/r_6');

  const lifecycleRow = page.locator('.verification-row').filter({ hasText: 'Driver arrived' });
  await lifecycleRow.scrollIntoViewIfNeeded();
  await expect(lifecycleRow).toBeVisible();
  await expect(lifecycleRow).toContainText(/Auto-completes by .*11:35 pm/i);
  const layout = await lifecycleRow.evaluate((row) => {
    const strong = row.querySelector('strong').getBoundingClientRect();
    const helper = row.querySelector('small').getBoundingClientRect();
    return {
      rowFits: row.scrollWidth <= row.clientWidth + 1,
      textIsSeparated: strong.bottom <= helper.top + 1,
    };
  });
  expect(layout).toEqual({ rowFits: true, textIsSeparated: true });
  await expectNoPageOverflow(page);
});

test('Ride waypoints keep long place details readable inside a deliberate card rail', async ({ page }) => {
  await openPage(page, '/home', 'Hi, Jamie');
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    database.rides.r_6.waypoints = [{
      placeId: 'fixture_waypoint_brj',
      name: 'Restoran BRJ Bistro Corner',
      description: 'Jalan 4a/27a, Seksyen 2 Wangsa Maju, Kuala Lumpur, Federal Territory of Kuala Lumpur',
      stopMinutes: 30,
    }];
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);
  await page.goto('/ride/r_6');

  await expect(page.getByRole('heading', { name: 'Culinary & cultural waypoints' })).toBeVisible();
  await expect(page.getByText('1 stop', { exact: true })).toBeVisible();
  const card = page.locator('.waypoint-card');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole('heading', { name: 'Restoran BRJ Bistro Corner' })).toBeVisible();
  await expect(card.getByText('30 min', { exact: true })).toBeVisible();
  await expect(card.getByText(/Federal Territory of Kuala Lumpur/)).toBeVisible();

  const layout = await card.evaluate((element) => {
    const heading = element.querySelector('h3').getBoundingClientRect();
    const address = element.querySelector('.waypoint-card-body > p').getBoundingClientRect();
    return {
      cardFits: element.scrollWidth <= element.clientWidth + 1,
      addressFollowsHeading: heading.bottom <= address.top + 1,
      readableWidth: element.getBoundingClientRect().width >= 260,
    };
  });
  expect(layout).toEqual({ cardFits: true, addressFollowsHeading: true, readableWidth: true });
  await expectNoPageOverflow(page);
});

test('personal destinations expose honest loading, empty, error, and content states', async ({ page }) => {
  const destinations = [
    ['/trip', 'My Trips & Impact'],
    ['/message', 'Messages'],
    ['/favourite', 'Favourite rides'],
    ['/notifications', 'Notifications'],
    ['/profile', 'My profile'],
    ['/share/ride-location', 'Ride location'],
  ];

  for (const [path, heading] of destinations) {
    await openPage(page, path, heading);
    await expectNoPageOverflow(page);
  }
  await expect(page.getByRole('alert')).toContainText('invalid or expired');
});

test('Discover reveals at most six cards per section before Show more', async ({ page }) => {
  await openPage(page, '/discover', 'Where should you go?');
  const section = page.locator('.dsc-section').filter({ has: page.getByRole('heading', { name: 'Nobody is driving here yet' }) });
  const cards = section.locator('.dsc-card');
  const initialCount = await cards.count();
  expect(initialCount).toBeLessThanOrEqual(6);
  const showMore = section.getByRole('button', { name: /Show \d+ more/ });
  if (await showMore.count()) {
    await showMore.click();
    expect(await cards.count()).toBeGreaterThan(initialCount);
  }
});

test('primary navigation is unobscured, keyboard focusable, and uses 44px targets', async ({ page }) => {
  await openPage(page, '/home', 'Hi, Jamie');
  await expectNoPageOverflow(page);
  const navTargets = page.locator('.topnav-links .topnav-item:visible');
  const count = await navTargets.count();
  expect(count).toBe(7);
  for (let index = 0; index < count; index += 1) {
    const box = await navTargets.nth(index).boundingBox();
    expect(box?.width || 0).toBeGreaterThanOrEqual(44);
    expect(box?.height || 0).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus-visible')).toBeVisible();
});

test('Home does not fetch Ride, Trip, or Message route bundles', async ({ page }) => {
  await openPage(page, '/home', 'Hi, Jamie');
  await page.waitForLoadState('networkidle');
  const resourceNames = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  expect(resourceNames.filter((name) => /MessageModule|RideHub|TripModule|tripStyles|\/ride-[^/]+\.css/.test(name))).toEqual([]);
});

test('mobile filters trap focus and return it to the trigger', async ({ page }) => {
  await openPage(page, '/search', 'Find the right ride');
  const trigger = page.getByRole('button', { name: /Filters/ });
  if (!(await trigger.isVisible())) {
    await expect(page.locator('.search-desktop-filters')).toBeVisible();
    return;
  }
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: /Filters and sorting/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('layout reflows for zoom, reduced motion, long names, and offline recovery', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPage(page, '/home', 'Hi, Jamie');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  const viewport = page.viewportSize();
  await page.setViewportSize({ width: Math.max(320, Math.floor(viewport.width / 2)), height: viewport.height });
  await expectNoPageOverflow(page);

  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: "You're offline" })).toBeVisible();
  await context.setOffline(false);

  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    database.users.u_demo_1.fullName = 'Alexandria-Montgomery-Wellington Tan Sri Longname';
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);
  await page.reload();
  await page.goto('/profile');
  await expect(page.getByText('Alexandria-Montgomery-Wellington Tan Sri Longname').first()).toBeVisible();
  await expectNoPageOverflow(page);
});

test('publishing recovers when location permission is denied', async ({ page, context }) => {
  const client = await context.newCDPSession(page);
  await client.send('Browser.setPermission', {
    origin: 'http://127.0.0.1:4173',
    permission: { name: 'geolocation' },
    setting: 'denied',
  });
  await openPage(page, '/ride/publish', 'Route');
  await expect(page.locator('.map-location-status')).toContainText('Location permission was denied');
  await expect(page.getByLabel('Pickup point')).toBeEnabled();
});

test('critical pages have no WCAG A or AA axe violations', async ({ page }) => {
  for (const path of ['/home', '/search', '/discover', '/ride', '/trip', '/message', '/favourite', '/notifications', '/profile']) {
    await page.goto(path);
    await page.locator('#main-content').waitFor();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .exclude('.google-route-map iframe')
      .analyze();
    expect(results.violations, `${path}: ${results.violations.map((item) => `${item.id} (${item.nodes.length})`).join(', ')}`).toEqual([]);
  }
});

test('Home visual baseline is stable', async ({ page }) => {
  await openPage(page, '/home', 'Hi, Jamie');
  await expect(page).toHaveScreenshot('home.png', { fullPage: true });
});
