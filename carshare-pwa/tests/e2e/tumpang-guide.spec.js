import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.route('https://api.open-meteo.com/**', (route) => route.abort());
});

async function openGuide(page) {
  await expect(page.getByRole('heading', { name: 'Your local friend for the next good day out.' })).toBeVisible();
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
  await page.getByLabel('From').fill('2026-09-15');
  await page.getByLabel('People').fill('2');
  await page.getByRole('button', { name: 'Nature', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByLabel('Message Tumpang Guide').fill('Plan a nature day for us');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.guide-rec-card').first()).toBeVisible();
}

async function seedGuideRideForSelectedDate(page) {
  await page.evaluate(() => {
    const storageKey = 'letstumpang_mock_db_v1';
    const database = JSON.parse(localStorage.getItem(storageKey));
    // The base fixture rides are historical. Attach one future published ride
    // to the nearby nature fixture so this test can verify the positive Search
    // hand-off as well as the separate no-ride states covered by discovery UI
    // tests. The product still decides the button from rideSummary.
    Object.assign(database.rides.r_5, {
      destination: 'Sekinchan',
      destinationLocation: { source: 'place', placeId: 'fixture_sekinchan' },
      date: '2026-09-15',
      time: '07:00',
      departureAt: '2026-09-15T00:05:00.000Z',
      status: 'Published',
      expiredAt: null,
      seatsAvailable: 3
    });
    localStorage.setItem(storageKey, JSON.stringify(database));
  });
}

test('Explore opens an unsent Guide planning chat with the current Travel Brief', async ({ page }) => {
  await page.goto('/home?date=2026-09-15');
  await expect(page.getByRole('heading', { name: 'Where should you go?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Plan my day' }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await openGuide(page);
  await expect(page.locator('.guide-message--user')).toHaveCount(0);

  await openTravelBrief(page);
  await expect(page.getByLabel('From')).toHaveValue('2026-09-15');
  await expect(page.getByLabel('Starting point')).toHaveValue(/Kuala Lumpur/i);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'New chat' }).click();
  await openTravelBrief(page);
  await expect(page.getByLabel('From')).toHaveValue('2026-09-15');
  await page.keyboard.press('Escape');
});

test('Tumpang Guide produces local database-only choices and preserves Search and Discover-detail hand-offs', async ({ page }) => {
  await page.goto('/assistant');
  await openGuide(page);
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

  await seedGuideRideForSelectedDate(page);
  await requestRecommendations(page);
  await expect(page.getByText('Best match', { exact: true })).toBeVisible();
  const recommendationCount = await page.locator('.guide-rec-card').count();
  expect(recommendationCount).toBeGreaterThanOrEqual(1);
  expect(recommendationCount).toBeLessThanOrEqual(3);

  // The fixture now has one available ride for the selected nature place. The
  // card action is therefore the Search hand-off; cards with no ride use Ride
  // alert instead, which is covered by the discovery state tests.
  const rideCard = page.locator('.guide-rec-card').filter({ has: page.getByRole('button', { name: /Find a ride/ }) }).first();
  await expect(rideCard).toBeVisible();
  await rideCard.getByRole('button', { name: /Find a ride/ }).click();
  await expect(page).toHaveURL(/\/search\?.*destinationPlaceId=/);
  await page.goto('/assistant');
  await openGuide(page);
  await seedGuideRideForSelectedDate(page);
  await requestRecommendations(page);
  const firstCard = page.locator('.guide-rec-card').first();
  await firstCard.getByRole('button', { name: /Why this/ }).click();
  await expect(firstCard.locator('.guide-why')).toBeVisible();
  await firstCard.getByRole('button', { name: /View full destination details/ }).click();
  await expect(page).toHaveURL(/\/discover\/[^/?]+\?date=2026-09-15/);
  await expect(page.getByRole('button', { name: /Back to Tumpang Guide/ })).toBeVisible();
  await page.getByRole('button', { name: /Back to Tumpang Guide/ }).click();
  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.locator('.guide-rec-card').first()).toBeVisible();
});

test('a recommendation without a listed ride still keeps the Find a ride hand-off', async ({ page }) => {
  await page.goto('/assistant');
  await openGuide(page);
  await requestRecommendations(page);

  const card = page.locator('.guide-rec-card').first();
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: /Find a ride/ })).toBeVisible();
  await expect(card.getByRole('button', { name: /Ride alert/ }).first()).toBeVisible();
});

test('destination questions enter Guide as an editable handoff without sending automatically', async ({ page }) => {
  await page.goto('/discover/p_georgetown?date=2026-09-14');
  await expect(page.getByRole('heading', { name: 'George Town Heritage Core', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ask Tumpang Guide' }).click();
  await openGuide(page);

  await expect(page.getByRole('status')).toContainText('Question about George Town Heritage Core');
  await expect(page.getByRole('status')).toContainText('What should I know before visiting George Town Heritage Core?');
  await expect(page.locator('.guide-message--user')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use this question' }).click();
  await expect(page.getByLabel('Message Tumpang Guide')).toHaveValue('What should I know before visiting George Town Heritage Core?');
});

test('Tumpang Guide stays keyboard-accessible and stops recommendations for emergencies', async ({ page }) => {
  await page.goto('/assistant');
  await openGuide(page);
  const message = page.getByLabel('Message Tumpang Guide');
  const send = page.getByRole('button', { name: 'Send message' });
  await message.fill('Someone is unconscious and needs an ambulance now');
  await send.click();
  await expect(page.getByRole('link', { name: 'Call 999' })).toBeVisible();
  await expect(page.locator('.guide-rec-card')).toHaveCount(0);

  // Emergency intent must win over masking of ordinary profanity. This is a
  // regression for the live mixed-language/content-safety policy boundary.
  await page.getByRole('button', { name: 'New chat' }).click();
  await message.fill('Damn, I am in danger, please help me now');
  await send.click();
  await expect(page.getByRole('link', { name: 'Call 999' })).toBeVisible();
  await expect(page.locator('.guide-rec-card')).toHaveCount(0);

  const results = await new AxeBuilder({ page }).exclude('.topnav').exclude('.mobile-appbar').analyze();
  expect(results.violations).toEqual([]);
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});

test('browser voice inserts one editable draft after silence without sending', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      constructor() {
        this.stopCalls = 0;
        this.startCalls = 0;
        window.__guideFakeRecognition = this;
      }

      start() {
        this.startCalls += 1;
        this.onstart?.();
      }

      stop() {
        this.stopCalls += 1;
        this.onend?.();
      }

      abort() {
        this.onend?.();
      }

      emitResult(text, isFinal, index = 0) {
        const result = [{ transcript: text, confidence: 0.99 }];
        result.isFinal = isFinal;
        const results = Array.from({ length: index + 1 }, () => []);
        results[index] = result;
        this.onresult?.({ resultIndex: index, results });
      }
    }
    window.SpeechRecognition = FakeSpeechRecognition;
  });

  await page.goto('/assistant');
  await openGuide(page);
  const message = page.getByLabel('Message Tumpang Guide');
  await page.getByRole('button', { name: 'Start voice input' }).click();
  await expect(page.getByRole('button', { name: 'Stop voice input' })).toBeVisible();

  await page.evaluate(() => window.__guideFakeRecognition.emitResult('Find nature places', true, 0));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__guideFakeRecognition.emitResult('near Johor Bahru', false, 1));
  await expect(message).toHaveValue('', { timeout: 1_000 });
  await page.evaluate(() => window.__guideFakeRecognition.emitResult('near Johor Bahru', true, 1));

  await expect(message).toHaveValue('Find nature places near Johor Bahru', { timeout: 4_000 });
  await expect(message).toBeFocused();
  await expect(page.locator('.guide-message--user')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__guideFakeRecognition.stopCalls)).toBe(1);
  await page.waitForTimeout(400);
  await expect.poll(() => page.evaluate(() => window.__guideFakeRecognition.startCalls)).toBe(1);
});

test('typed profanity is masked while targeted abuse is blocked and cooldown prevents repeated abuse', async ({ page }) => {
  await page.goto('/assistant');
  await openGuide(page);
  const message = page.getByLabel('Message Tumpang Guide');
  const send = page.getByRole('button', { name: 'Send message' });

  await message.fill('Damn, show me nature places near Kuala Lumpur');
  await send.click();
  await expect(page.locator('.guide-message--user').first()).toContainText('****, show me nature places near Kuala Lumpur');
  await expect(page.locator('.guide-composer__safety-note')).toContainText('masked');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await message.fill('You are stupid, show me a place');
    await send.click();
    await expect(page.locator('.guide-composer__safety-error')).toContainText('personal insults');
  }
  await expect(send).toBeDisabled();
  await expect(page.locator('.guide-composer__safety-note')).toContainText('15');
  await expect(page.locator('.guide-message--user')).toHaveCount(1);
});

test('language is AI-managed, New chat stays visible and ordinary replies are not disclosure widgets', async ({ page }) => {
  await page.goto('/assistant');
  await openGuide(page);
  await expect(page.getByRole('button', { name: 'Guide language' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await page.getByLabel('Message Tumpang Guide').fill('How does this work?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.guide-message__content > details')).toHaveCount(0);
});
