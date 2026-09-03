import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test('Friends stays usable at every viewport when migration 079 is unavailable', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Hi, Jamie' })).toBeVisible();
  await page.goto('/message/friends');

  await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible();
  await expect(page.getByText('Friends requires a configured Supabase connection.')).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);

  const back = page.getByRole('button', { name: 'Messages' });
  await back.focus();
  await expect(back).toBeFocused();
  await back.click();
  await expect(page).toHaveURL(/\/message$/);
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();

  const rideMessages = page.getByRole('tab', { name: /Ride messages/ });
  const friendMessages = page.getByRole('tab', { name: /Friend messages/ });
  await expect(rideMessages).toBeVisible();
  await expect(friendMessages).toBeVisible();
  await expect(rideMessages).toHaveAttribute('aria-selected', 'true');
  await friendMessages.click();
  await expect(friendMessages).toHaveAttribute('aria-selected', 'true');
});
