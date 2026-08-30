import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.route('https://api.open-meteo.com/**', (route) => route.abort());
});

async function dismissOnboarding(page) {
  await expect(page.getByRole('dialog', { name: 'Meet Tumpang Guide' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start planning' }).click();
}

async function requestRecommendations(page) {
  await page.getByLabel('Starting point').fill('Kuala Lumpur');
  await page.getByLabel('From').fill('2026-09-01');
  await page.getByLabel('People').fill('2');
  await page.getByRole('button', { name: 'Nature', exact: true }).click();
  await page.getByLabel('Message Tumpang Guide').fill('Plan a nature day for us');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.guide-rec-card')).toHaveCount(3);
}

test('Tumpang Guide produces three database-only choices and preserves the Discover/Search hand-off', async ({ page }) => {
  await page.goto('/assistant');
  await dismissOnboarding(page);
  await expect(page.getByRole('heading', { name: 'Your local friend for the next good day out.' })).toBeVisible();

  const planOverflow = await page.locator('.guide-plan').evaluate((plan) => {
    const card = plan.getBoundingClientRect();
    return [...plan.querySelectorAll('input, select, button, textarea')]
      .filter((control) => {
        const bounds = control.getBoundingClientRect();
        return bounds.left < card.left - 1 || bounds.right > card.right + 1;
      })
      .map((control) => control.getAttribute('aria-label') || control.tagName.toLowerCase());
  });
  expect(planOverflow).toEqual([]);

  await requestRecommendations(page);
  await expect(page.getByText('Best match', { exact: true })).toBeVisible();
  await expect(page.getByText('Practical alternative', { exact: true })).toBeVisible();
  await expect(page.getByText('Wildcard', { exact: true })).toBeVisible();

  // Find a ride belongs to the Guide recommendation card. The existing
  // destination detail intentionally shows "I will drive" when no Ride serves
  // that place yet, so it is not the Search hand-off surface.
  await page.locator('.guide-rec-card').first().getByRole('button', { name: /Find a ride/ }).click();
  await expect(page).toHaveURL(/\/search\?.*destinationPlaceId=/);
  await page.goto('/assistant');
  await dismissOnboarding(page);
  await requestRecommendations(page);
  const firstCard = page.locator('.guide-rec-card').first();
  await firstCard.getByRole('button', { name: /Why this/ }).click();
  await expect(firstCard.locator('.guide-why')).toBeVisible();
  await firstCard.getByRole('button', { name: /View full destination details/ }).click();
  await expect(page).toHaveURL(/\/discover\/[^/?]+\?date=2026-09-01&from=guide/);
  await expect(page.getByText(/Tumpang Guide · Best match/)).toBeVisible();
});

test('Tumpang Guide stays keyboard-accessible and stops recommendations for emergencies', async ({ page }) => {
  await page.goto('/assistant');
  await dismissOnboarding(page);
  await page.getByLabel('Message Tumpang Guide').fill('SOS I am in danger');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('link', { name: 'Call 999' })).toBeVisible();
  await expect(page.locator('.guide-rec-card')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).exclude('.topnav').exclude('.mobile-appbar').analyze();
  expect(results.violations).toEqual([]);
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});
