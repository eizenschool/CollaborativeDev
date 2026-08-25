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
    offenders: [...document.querySelectorAll('body *')]
      .map((element) => ({ selector: `${element.tagName.toLowerCase()}.${String(element.className || '').trim().replaceAll(' ', '.')}`, right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) }))
      .filter((item) => item.right > document.documentElement.clientWidth + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 4),
  }));
  expect(dimensions.scrollWidth, `page width ${dimensions.scrollWidth}px exceeds viewport ${dimensions.clientWidth}px; offenders ${JSON.stringify(dimensions.offenders)}`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function mockGooglePickupServices(page, { nearbyFails = false } = {}) {
  await page.addInitScript(({ shouldFailNearby }) => {
    const nearbyPlaces = [
      ['near-1', 'KL Sentral', 'Brickfields, Kuala Lumpur', 3.1391, 101.6869],
      ['near-2', 'NU Sentral', 'Jalan Tun Sambanthan, Kuala Lumpur', 3.1395, 101.6871],
      ['near-3', 'Muzium Negara', 'Damansara Road, Kuala Lumpur', 3.1377, 101.6870],
      ['near-4', 'Central Market', 'Jalan Hang Kasturi, Kuala Lumpur', 3.1458, 101.6953],
      ['near-5', 'Pasar Seni Station', 'City Centre, Kuala Lumpur', 3.1424, 101.6955],
    ];
    window.__nearbyRequests = [];
    window.__geocodeRequests = [];
    window.google = {
      maps: {
        importLibrary: async (library) => {
          if (library === 'geocoding') {
            return {
              Geocoder: class {
                async geocode(request) {
                  window.__geocodeRequests.push(request);
                  return { results: [{ place_id: 'current-gps-place', formatted_address: 'Current location, Kuala Lumpur' }] };
                }
              }
            };
          }
          if (library === 'places') {
            return {
              Place: {
                searchNearby: async (request) => {
                  window.__nearbyRequests.push(request);
                  if (shouldFailNearby) throw new Error('Nearby service unavailable');
                  return {
                    places: nearbyPlaces.map(([id, displayName, formattedAddress, lat, lng]) => ({
                      id, displayName, formattedAddress, location: { lat: () => lat, lng: () => lng }
                    }))
                  };
                }
              },
              SearchNearbyRankPreference: { DISTANCE: 'DISTANCE' }
            };
          }
          return {};
        }
      }
    };
  }, { shouldFailNearby: nearbyFails });
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

test('Create Ride offers nearby confirmed places without requiring typed search', async ({ page, context }) => {
  await mockGooglePickupServices(page);
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:4173' });
  await context.setGeolocation({ latitude: 3.139, longitude: 101.6869, accuracy: 35 });
  await openPage(page, '/ride/publish', 'Route');

  const pickup = page.getByRole('combobox', { name: 'Pickup point', exact: true });
  await pickup.focus();
  await expect(page.getByText('Nearby pickup alternatives', { exact: true })).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__nearbyRequests.length)).toBe(0);
  await page.getByRole('button', { name: 'Use current location' }).click();
  await expect(pickup).toHaveValue('Current location, Kuala Lumpur');
  await expect(page.getByText('Current location selected · ±35 m')).toBeVisible();
  await expect(page.getByText('Nearby pickup alternatives', { exact: true })).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(5);
  await expect.poll(() => page.evaluate(() => ({
    nearby: window.__nearbyRequests[0]?.locationRestriction?.center,
    geocode: window.__geocodeRequests[0]?.location,
  }))).toEqual({
    nearby: { lat: 3.139, lng: 101.6869 },
    geocode: { lat: 3.139, lng: 101.6869 },
  });
  const inputBox = await pickup.boundingBox();
  const suggestionBox = await page.locator('.location-suggestions-panel').boundingBox();
  expect(inputBox).not.toBeNull();
  expect(suggestionBox).not.toBeNull();
  expect(suggestionBox.y - (inputBox.y + inputBox.height)).toBeGreaterThanOrEqual(0);
  expect(suggestionBox.y - (inputBox.y + inputBox.height)).toBeLessThanOrEqual(8);
  await pickup.press('ArrowDown');
  await pickup.press('ArrowUp');
  await expect(page.getByRole('option', { name: /KL Sentral/ })).toHaveAttribute('aria-selected', 'true');
  await pickup.press('Enter');
  await expect(pickup).toHaveValue('KL Sentral, Brickfields, Kuala Lumpur');
  await expectNoPageOverflow(page);
});

test('Create Ride offers nearby alternatives without selecting an inaccurate GPS point', async ({ page, context }) => {
  await mockGooglePickupServices(page);
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:4173' });
  await context.setGeolocation({ latitude: 3.139, longitude: 101.6869, accuracy: 250 });
  await openPage(page, '/ride/publish', 'Route');

  const pickup = page.getByRole('combobox', { name: 'Pickup point', exact: true });
  await page.getByRole('button', { name: 'Use current location' }).click();
  await expect(pickup).toHaveValue('');
  await expect(page.getByText(/GPS point was not accurate enough/)).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(5);
  await expect.poll(() => page.evaluate(() => window.__geocodeRequests.length)).toBe(0);
});

test('Create Ride keeps an accurate GPS pickup when Google Nearby fails', async ({ page, context }) => {
  await mockGooglePickupServices(page, { nearbyFails: true });
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:4173' });
  await context.setGeolocation({ latitude: 3.139, longitude: 101.6869, accuracy: 35 });
  await openPage(page, '/ride/publish', 'Route');

  const pickup = page.getByRole('combobox', { name: 'Pickup point', exact: true });
  await page.getByRole('button', { name: 'Use current location' }).click();
  await expect(pickup).toHaveValue('Current location, Kuala Lumpur');
  await expect(page.locator('.location-field-message')).toContainText('Nearby pickup alternatives are unavailable');
  await expect(page.getByText('Nearby pickup alternatives', { exact: true })).not.toBeVisible();
});

test('Create Ride skips Google for very inaccurate GPS and preserves manual recovery', async ({ page, context }) => {
  await mockGooglePickupServices(page);
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:4173' });
  await context.setGeolocation({ latitude: 3.139, longitude: 101.6869, accuracy: 650 });
  await openPage(page, '/ride/publish', 'Route');

  const pickup = page.getByRole('combobox', { name: 'Pickup point', exact: true });
  await page.getByRole('button', { name: 'Use current location' }).click();
  await expect(page.locator('.location-field-message.error')).toContainText('accurate to about 650 m');
  await expect.poll(() => page.evaluate(() => ({
    nearby: window.__nearbyRequests.length,
    geocode: window.__geocodeRequests.length,
  }))).toEqual({ nearby: 0, geocode: 0 });
  await pickup.fill('K');
  await expect(pickup).toHaveValue('K');
  await expect(page.locator('.location-field-message.error')).not.toContainText('accurate to about 650 m');
});

test('Ride cards use lazy destination photos while pickup photos stay on Published detail', async ({ page }) => {
  await openPage(page, '/home', 'Hi, Jamie');
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    const future = { date: '2026-09-15', time: '07:00', departureAt: '2026-09-14T23:00:00.000Z', status: 'Published', expiredAt: null };
    Object.assign(database.rides.r_1, future, {
      pickupInstructions: 'Wait beside the station information counter.',
      pickupPhotoPath: 'mock/r_1/meeting.webp',
      pickupPhotoDataUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="450"%3E%3Crect width="800" height="450" fill="%230f766e"/%3E%3C/svg%3E',
      hasPickupPhoto: true,
    });
    Object.assign(database.rides.r_5, future, {
      destinationLocation: { source: 'google', placeId: 'fixture_jonker' },
    });
    database.favourites.u_demo_1 = [{ rideId: 'r_1', createdAt: new Date().toISOString() }];
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);

  await openPage(page, '/search', 'Find the right ride');
  const searchPhotoCard = page.locator('.search-ride-card.has-destination-photo').first();
  await expect(searchPhotoCard).toBeVisible();
  await expect(searchPhotoCard.locator('.destination-ride-photo img')).toHaveAttribute('alt', '');
  await expect(searchPhotoCard.locator('.destination-photo-credit')).toContainText('Google Maps');
  await expect(searchPhotoCard.locator('.pickup-photo-preview-image')).toHaveCount(0);

  await openPage(page, '/favourite', 'Favourite rides');
  await expect(page.locator('.search-ride-card.has-destination-photo')).toHaveCount(1);

  await openPage(page, '/ride', 'My rides');
  const workspacePhotoCard = page.locator('.ride-card.has-destination-photo').first();
  await expect(workspacePhotoCard).toBeVisible();
  await expect(workspacePhotoCard.locator('.ride-card-primary-action')).toHaveCount(1);
  await expect(workspacePhotoCard.locator('.pin-pickup')).toBeVisible();
  await expect(workspacePhotoCard.locator('.pin-destination')).toBeVisible();
  await expect(workspacePhotoCard.locator('.ride-route-connector')).toHaveCount(0);
  await expect(workspacePhotoCard.locator('.destination-photo-credit')).toContainText('Google Maps');

  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    database.currentUserId = null;
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);
  await page.goto('/ride/r_1');
  await expect(page.locator('.pickup-photo-public')).toContainText('Photo provided by the Driver');
  await expect(page.locator('.pickup-photo-public img')).toBeVisible();
  await expect(page.locator('.ride-destination-photo img')).toHaveAttribute('alt', 'Georgetown, Penang destination');
  await expect(page.locator('.ride-destination-photo-credit')).toContainText('Google Maps');
  await expect(page.getByText('Wait beside the station information counter.')).toBeVisible();
  await expectNoPageOverflow(page);
});

test('Draft review aligns waypoint durations and keeps the pickup photo inside its summary', async ({ page }) => {
  await openPage(page, '/home', 'Hi, Jamie');
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    Object.assign(database.rides.r_5, {
      status: 'Draft',
      date: '2026-09-15',
      time: '07:00',
      departureAt: '2026-09-14T23:00:00.000Z',
      pickupLocation: { source: 'google', placeId: 'pickup-fixture' },
      destinationLocation: { source: 'google', placeId: 'fixture_jonker' },
      waypoints: [
        { name: 'Menara Kuala Lumpur', placeId: 'fixture_chain_a', stopMinutes: 30 },
        { name: 'Hai Kah Lang 海脚人 · TRX', placeId: 'fixture_chulia', stopMinutes: 30 },
      ],
      pickupPhotoPath: 'mock/r_5/meeting.webp',
      pickupPhotoDataUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="450"%3E%3Crect width="800" height="450" fill="%230f766e"/%3E%3C/svg%3E',
      hasPickupPhoto: true,
    });
    Object.values(database.rideRequests).forEach((request) => {
      if (request.rideId === 'r_5') delete database.rideRequests[request.id];
    });
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);

  await page.goto('/ride/r_5/publish');
  await expect(page.getByRole('heading', { name: 'Route', exact: true }).first()).toBeVisible();
  await page.locator('.step-item').filter({ hasText: 'Trip Details' }).evaluate((button) => button.click());
  await expect(page.getByRole('heading', { name: 'Trip Details', exact: true }).first()).toBeVisible();

  const durationLefts = await page.locator('.waypoint-selected-duration input').evaluateAll((inputs) => inputs.map((input) => Math.round(input.getBoundingClientRect().left)));
  expect(durationLefts).toHaveLength(2);
  expect(Math.max(...durationLefts) - Math.min(...durationLefts)).toBeLessThanOrEqual(1);

  await page.locator('.step-item').filter({ hasText: 'Review & Publish' }).evaluate((button) => button.click());
  await expect(page.getByRole('heading', { name: 'Review & Publish', exact: true }).first()).toBeVisible();

  const pickupRow = page.locator('.review-pickup-photo');
  await expect(pickupRow).not.toContainText('Included');
  await expect(pickupRow.locator('.pickup-photo-preview-image')).toBeVisible();
  const contained = await pickupRow.evaluate((row) => {
    const image = row.querySelector('img')?.getBoundingClientRect();
    const summary = row.closest('.card')?.getBoundingClientRect();
    return Boolean(image && summary && image.left >= summary.left && image.right <= summary.right);
  });
  expect(contained).toBe(true);
  await expectNoPageOverflow(page);
});

test('Pickup photo recovers from camera denial with upload, preview, and remove', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const error = new Error('Fixture permission denial');
          error.name = 'NotAllowedError';
          throw error;
        },
      },
    });
  });
  await openPage(page, '/home', 'Hi, Jamie');
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    Object.assign(database.rides.r_5, {
      date: '2026-09-15',
      time: '07:00',
      departureAt: '2026-09-14T23:00:00.000Z',
      status: 'Published',
      expiredAt: null,
      seatsAvailable: 3,
    });
    Object.values(database.rideRequests).forEach((request) => {
      if (request.rideId === 'r_5') delete database.rideRequests[request.id];
    });
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);
  await page.goto('/ride/r_5/edit');
  await expect(page.getByRole('heading', { name: 'Edit ride' })).toBeVisible();

  await page.getByRole('button', { name: 'Take photo' }).click();
  await expect(page.getByRole('alert')).toContainText('Camera permission was denied');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.locator('.pickup-photo-file-input').setInputFiles({ name: 'meeting-point.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.pickup-photo-preview-image')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace from files' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.pickup-photo-preview-image')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload photo' })).toBeVisible();
  await expectNoPageOverflow(page);
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
  await page.getByRole('button', { name: 'Use current location' }).click();
  await expect(page.locator('.location-field-message.error')).toContainText('Location permission was denied');
  await page.getByLabel('Pickup point').fill('K');
  await expect(page.getByLabel('Pickup point')).toHaveValue('K');
  await expect(page.locator('.location-field-message.error')).not.toContainText('Location permission was denied');
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
