import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

async function openRadiusFilters(page) {
  if ((page.viewportSize()?.width || 0) <= 700) {
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('dialog', { name: 'Filters and sorting' })).toBeVisible();
  }
}

function filterScope(page) {
  return (page.viewportSize()?.width || 0) <= 700
    ? page.getByRole('dialog', { name: 'Filters and sorting' })
    : page.locator('.search-desktop-filters');
}

async function radiusButtons(page) {
  const scope = filterScope(page);
  return [5, 10, 25].map((radius) => scope.getByRole('button', { name: `${radius} km`, exact: true }));
}

test('radius controls are responsive, exact by default, and gated by destination confirmation', async ({ page }) => {
  await page.goto('/search');
  await openRadiusFilters(page);
  for (const button of await radiusButtons(page)) await expect(button).toBeDisabled();
  await expect(filterScope(page).getByText('Choose a confirmed destination to use a radius.')).toBeVisible();

  await page.goto('/search?destination=KLCC&destinationSearchPlaceId=google-klcc');
  await openRadiusFilters(page);
  for (const button of await radiusButtons(page)) {
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(filterScope(page).getByText('Exact destination matching is selected.')).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('a passenger can apply and clear every supported radius without changing the destination', async ({ page }) => {
  await page.goto('/search?destination=KLCC&destinationSearchPlaceId=google-klcc');
  await openRadiusFilters(page);
  const buttons = await radiusButtons(page);

  for (const [index, radius] of [5, 10, 25].entries()) {
    await buttons[index].click();
    await expect(buttons[index]).toHaveAttribute('aria-pressed', 'true');
    await expect(filterScope(page).getByText(`Matches verified ride destinations near KLCC.`)).toBeVisible();
    expect(await page.locator('#smart-search-destination').inputValue()).toBe('KLCC');
    await filterScope(page).getByRole('button', { name: 'Match exact destination' }).click();
    await expect(buttons[index]).toHaveAttribute('aria-pressed', 'false');
  }
});
