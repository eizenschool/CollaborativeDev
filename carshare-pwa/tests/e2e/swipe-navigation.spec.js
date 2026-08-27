import { expect, test } from '@playwright/test';

const MOCK_STORAGE_KEY = 'letstumpang_mock_db_v1';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('swipe-navigation-e2e-ready')) return;
    localStorage.clear();
    sessionStorage.setItem('swipe-navigation-e2e-ready', 'true');
  });
});

async function dispatchTouch(page, selector, start, end) {
  await page.locator(selector).first().evaluate((element, points) => {
    const emit = (type, touches, changedTouches = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: touches },
        changedTouches: { value: changedTouches }
      });
      element.dispatchEvent(event);
    };
    const touch = (point) => ({
      identifier: 1,
      target: element,
      clientX: point.x,
      clientY: point.y
    });
    emit('touchstart', [touch(points.start)]);
    emit('touchmove', [touch(points.end)]);
    emit('touchend', [], [touch(points.end)]);
  }, { start, end });
}

test('touch swipes follow primary navigation order without hijacking other interactions', async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) !== 375, 'Focused phone gesture coverage.');

  await page.goto('/search');
  await expect(page.getByRole('heading', { name: 'Find the right ride' })).toBeVisible();
  await dispatchTouch(page, '.smart-search-hero', { x: 310, y: 170 }, { x: 86, y: 172 });
  const routeFrames = page.locator('.ui-swipe-route-frame');
  await expect(routeFrames).toHaveCount(2);
  const transitionX = await routeFrames.evaluateAll((frames) => frames.map((frame) => (
    new DOMMatrixReadOnly(getComputedStyle(frame).transform).m41
  )));
  expect(transitionX.some((x) => x > 0)).toBe(true);
  await expect(page).toHaveURL(/\/ride$/);
  await expect(page.getByRole('heading', { name: 'My rides' })).toBeVisible();
  await expect(routeFrames).toHaveCount(1);
  await expect(page.locator('.ui-swipe-route-frame:not([aria-hidden="true"]) #main-content')).toBeFocused();

  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  await dispatchTouch(page, '.profile-page', { x: 74, y: 260 }, { x: 302, y: 262 });
  await expect(page).toHaveURL(/\/favourite$/);

  await page.goto('/home');
  await dispatchTouch(page, '.home-greeting', { x: 76, y: 145 }, { x: 305, y: 145 });
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator('.ui-swipe-route-frame .topnav')).toHaveCount(0);
  await expect(page.locator('.topnav')).toHaveCSS('position', 'fixed');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const fixedNavBox = await page.locator('.topnav').boundingBox();
  expect(Math.abs((fixedNavBox.y + fixedNavBox.height) - 812)).toBeLessThan(1);
  await expect(page.locator('.dsc-rail-track')).toBeVisible();
  await dispatchTouch(page, '.dsc-rail-track', { x: 310, y: 650 }, { x: 76, y: 650 });
  await expect(page).toHaveURL(/\/home$/);

  await page.goto('/search');
  await dispatchTouch(page, '.smart-search-hero', { x: 260, y: 150 }, { x: 242, y: 151 });
  await expect(page).toHaveURL(/\/search$/);
  await dispatchTouch(page, '.smart-search-hero', { x: 250, y: 135 }, { x: 230, y: 278 });
  await expect(page).toHaveURL(/\/search$/);
  await dispatchTouch(page, '.smart-search-hero', { x: 5, y: 150 }, { x: 250, y: 150 });
  await expect(page).toHaveURL(/\/search$/);

  // The full page can begin the phone gesture, including cards, form surfaces,
  // ordinary buttons, and the persistent navigation bar.
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Hi, Jamie' })).toBeVisible();
  await page.locator('a[href="/trip"]').click();
  await expect(page).toHaveURL(/\/trip$/);
  await dispatchTouch(page, '.m5-trip-card', { x: 310, y: 390 }, { x: 76, y: 392 });
  await expect(page).toHaveURL(/\/message$/);

  await page.goto('/search');
  await dispatchTouch(page, '.smart-search-form', { x: 300, y: 280 }, { x: 70, y: 280 });
  await expect(page).toHaveURL(/\/ride$/);
  await page.goto('/search');
  await dispatchTouch(page, '.search-mobile-filter-button', { x: 300, y: 220 }, { x: 70, y: 220 });
  await expect(page).toHaveURL(/\/ride$/);

  await page.goto('/search');
  await dispatchTouch(page, '.topnav', { x: 300, y: 780 }, { x: 70, y: 780 });
  await expect(page).toHaveURL(/\/ride$/);

  // Text controls and gesture-heavy regions still retain their native gesture.
  await page.goto('/search');
  await dispatchTouch(page, '.smart-search-form input', { x: 300, y: 280 }, { x: 70, y: 280 });
  await expect(page).toHaveURL(/\/search$/);
  await page.locator('.search-mobile-filter-button').click();
  await expect(page.locator('.ui-dialog')).toBeVisible();
  await dispatchTouch(page, '.ui-dialog', { x: 300, y: 300 }, { x: 70, y: 300 });
  await expect(page).toHaveURL(/\/search$/);
  await page.keyboard.press('Escape');

  const hero = await page.locator('.smart-search-hero').boundingBox();
  await page.mouse.move(hero.x + hero.width * 0.8, hero.y + 30);
  await page.mouse.down();
  await page.mouse.move(hero.x + hero.width * 0.2, hero.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/search$/);

  await page.goto('/ride/r_1');
  await expect(page.locator('.ride-detail-page')).toBeVisible();
  await dispatchTouch(page, '.ride-detail-page', { x: 300, y: 250 }, { x: 70, y: 250 });
  await expect(page).toHaveURL(/\/ride\/r_1$/);
});

test('the Trips start-line car follows motion preference changes while the PWA stays open', async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) !== 375, 'Focused phone animation coverage.');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Hi, Jamie' })).toBeVisible();
  await page.locator('a[href="/trip"]').click();

  const car = page.locator('[data-road-runner="journey-start"]');
  await expect(car).toBeVisible();
  const movingStart = await car.getAttribute('transform');
  await page.waitForTimeout(300);
  await expect(car).not.toHaveAttribute('transform', movingStart);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(50);
  const parked = await car.getAttribute('transform');
  await page.waitForTimeout(300);
  await expect(car).toHaveAttribute('transform', parked);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(300);
  await expect(car).not.toHaveAttribute('transform', parked);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dispatchTouch(page, '.m5-journey-start', { x: 300, y: 720 }, { x: 70, y: 720 });
  await expect(page).toHaveURL(/\/message$/);
  await expect(page.locator('.ui-swipe-route-frame')).toHaveCount(1);
  await expect(page.locator('.ui-swipe-route-frame')).toHaveCSS('transform', 'none');
});

test('guest swipe from Search to Ride preserves the guarded return destination', async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) !== 375, 'Focused phone gesture coverage.');

  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Hi, Jamie' })).toBeVisible();
  await page.evaluate((storageKey) => {
    const database = JSON.parse(localStorage.getItem(storageKey));
    database.currentUserId = null;
    localStorage.setItem(storageKey, JSON.stringify(database));
  }, MOCK_STORAGE_KEY);

  await page.goto('/search');
  await expect(page.getByRole('heading', { name: 'Find the right ride' })).toBeVisible();
  await dispatchTouch(page, '.smart-search-hero', { x: 310, y: 170 }, { x: 76, y: 170 });
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByText('Sign in to open Ride.')).toBeVisible();

  await page.getByLabel('Email Address').fill('jamie@letstumpang.app');
  await page.locator('#auth-password').fill('fixture-pass');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/ride$/);
});

test('the page gesture stays disabled above the phone breakpoint', async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) <= 700, 'Non-phone viewport coverage.');

  await page.goto('/search');
  await expect(page.getByRole('heading', { name: 'Find the right ride' })).toBeVisible();
  await dispatchTouch(page, '.smart-search-hero', { x: 620, y: 170 }, { x: 120, y: 172 });
  await expect(page).toHaveURL(/\/search$/);
});
