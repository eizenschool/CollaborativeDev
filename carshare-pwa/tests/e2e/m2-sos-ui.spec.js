import { expect, test } from '@playwright/test';

test.skip(process.env.VITE_M2_SOS_ENABLED !== 'true', 'SOS UI is release-gated and fixture mode keeps it off by default.');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
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
