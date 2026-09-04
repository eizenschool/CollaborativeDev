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

// The former always-open "Your travel brief" sidebar is now a context bar
// above the composer that opens the same fields in the shared AdaptiveDialog
// (see GuideContextBar.jsx) - every field-fill now opens it first and closes
// it with Escape before the composer becomes reachable again, since the
// dialog is modal.
async function openTravelBrief(page) {
  await page.getByRole('button', { name: /Your travel brief/ }).click();
  await expect(page.getByRole('dialog', { name: /Your travel brief/ })).toBeVisible();
}

async function requestRecommendations(page) {
  await openTravelBrief(page);
  await page.getByLabel('Starting point').fill('Kuala Lumpur');
  await page.getByLabel('From').fill('2026-09-01');
  await page.getByLabel('People').fill('2');
  await page.getByRole('button', { name: 'Nature', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByLabel('Message Tumpang Guide').fill('Plan a nature day for us');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.guide-rec-card').first()).toBeVisible();
}

test('Tumpang Guide produces local database-only choices and preserves Search and Discover-detail hand-offs', async ({ page }) => {
  await page.goto('/assistant');
  await dismissOnboarding(page);
  await expect(page.getByRole('heading', { name: 'Your local friend for the next good day out.' })).toBeVisible();

  await openTravelBrief(page);
  const planOverflow = await page.locator('.guide-plan-fields').evaluate((plan) => {
    const card = plan.getBoundingClientRect();
    return [...plan.querySelectorAll('input, select, button, textarea')]
      .filter((control) => {
        const bounds = control.getBoundingClientRect();
        return bounds.left < card.left - 1 || bounds.right > card.right + 1;
      })
      .map((control) => control.getAttribute('aria-label') || control.tagName.toLowerCase());
  });
  expect(planOverflow).toEqual([]);
  await page.keyboard.press('Escape');

  await requestRecommendations(page);
  await expect(page.getByText('Best match', { exact: true })).toBeVisible();
  const recommendationCount = await page.locator('.guide-rec-card').count();
  expect(recommendationCount).toBeGreaterThanOrEqual(1);
  expect(recommendationCount).toBeLessThanOrEqual(3);

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
  await expect(page).toHaveURL(/\/discover\/[^/?]+\?date=2026-09-01/);
  await expect(page.getByRole('button', { name: /Back to Tumpang Guide/ })).toBeVisible();
  await page.getByRole('button', { name: /Back to Tumpang Guide/ }).click();
  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.locator('.guide-rec-card').first()).toBeVisible();
});

test('Tumpang Guide stays keyboard-accessible and stops recommendations for emergencies', async ({ page }) => {
  await page.goto('/assistant');
  await dismissOnboarding(page);
  await page.getByLabel('Message Tumpang Guide').fill('Someone is unconscious and needs an ambulance now');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('link', { name: 'Call 999' })).toBeVisible();
  await expect(page.locator('.guide-rec-card')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).exclude('.topnav').exclude('.mobile-appbar').analyze();
  expect(results.violations).toEqual([]);
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});

test('language is AI-managed, New chat stays visible and ordinary replies are not disclosure widgets', async ({ page }) => {
  await page.goto('/assistant');
  await dismissOnboarding(page);
  await expect(page.getByRole('button', { name: 'Guide language' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await page.getByLabel('Message Tumpang Guide').fill('How does this work?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.guide-message__content > details')).toHaveCount(0);
});
