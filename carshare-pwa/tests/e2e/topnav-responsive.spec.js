import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('topnav-responsive-e2e-ready')) return;
    localStorage.clear();
    sessionStorage.setItem('topnav-responsive-e2e-ready', 'true');
  });
});

test('split-screen desktop keeps every navigation destination and account action visible', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 800 });
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Hi, Jamie', exact: true })).toBeVisible();

  const navItems = page.locator('.topnav-links .topnav-item');
  await expect(navItems).toHaveCount(7);
  for (const label of ['Home', 'Search', 'Ride', 'Trips', 'Message', 'Favourite', 'Profile']) {
    await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: label })).toBeVisible();
  }
  await expect(page.locator('.topnav-brand .brand-title')).toBeVisible();
  await expect(page.locator('.topnav-item .nav-label').first()).toBeHidden();
  await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open my profile' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  const fit = await page.locator('.topnav').evaluate((nav) => ({
    left: nav.getBoundingClientRect().left,
    right: nav.getBoundingClientRect().right,
    scrollWidth: nav.scrollWidth,
    clientWidth: nav.clientWidth,
    actionRight: nav.querySelector('.topnav-actions').getBoundingClientRect().right,
  }));
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(960);
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
  expect(fit.actionRight).toBeLessThanOrEqual(960);
});
