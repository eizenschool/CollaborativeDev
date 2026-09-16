import { expect, test } from '@playwright/test';

test('queue routes message evidence cases to their protected review action', async ({ page }) => {
  await page.route('**/src/presentation/shared/context/AuthContext.jsx', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: "export const useAuth = () => ({ user: { id: 'admin', email: 'donghuanlin25@gmail.com' } });",
  }));
  await page.route('**/__message-report-queue*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace('/src/main.jsx', '/tests/e2e/fixtures/message-report-queue.jsx'),
    });
  });

  await page.goto('/__message-report-queue');
  const messageCase = page.locator('li').filter({ hasText: 'Harassment' });
  const profileCase = page.locator('li').filter({ hasText: 'Unsafe conduct outside chat' });

  await expect(messageCase.getByRole('button', { name: 'Review message evidence' })).toBeVisible();
  await expect(messageCase.getByRole('button', { name: 'Mark resolved' })).toHaveCount(0);
  await expect(messageCase.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
  await expect(profileCase.getByRole('button', { name: 'Review', exact: true })).toBeVisible();
  await expect(profileCase.getByRole('button', { name: 'Mark resolved' })).toBeVisible();
  await expect(profileCase.getByRole('button', { name: 'Dismiss' })).toBeVisible();

  await messageCase.getByRole('button', { name: 'Review message evidence' }).click();
  await expect(messageCase.getByText('Reported message evidence')).toBeVisible();
});

test('admin sees evidence and confirms the existing reputation outcome', async ({ page }, testInfo) => {
  await page.route('**/__message-report-admin*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('/src/main.jsx', '/tests/e2e/fixtures/message-report-admin.jsx') });
  });
  await page.goto('/__message-report-admin');
  await page.getByRole('button', { name: 'Review message evidence' }).click();
  await expect(page.getByText('Reported message evidence')).toBeVisible();
  await expect(page.locator('video')).toHaveAttribute('preload', 'none');
  await expect(page.locator('audio')).toHaveAttribute('preload', 'none');
  await page.getByLabel('Review outcome').selectOption('confirmed_serious_conduct');
  await expect(page.getByRole('status')).toContainText('Safety hold will be applied');
  await page.getByLabel('Decision reason').fill('Confirmed threat based on the reported evidence');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('admin-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm decision' }).click();
  await expect(page.getByRole('button', { name: 'Confirm decision' })).not.toBeVisible();
  expect(await page.evaluate(() => window.reviewDecision)).toEqual(['evidence','confirmed_serious_conduct','Confirmed threat based on the reported evidence',true]);
});
