import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/src/presentation/m3-messaging/context/MessagingSessionContext.jsx', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const useMessagingSession = () => window.chatTestSession;' }));
  await page.route('**/src/presentation/m3-messaging/context/CallSessionContext.jsx', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const useCallSession = () => ({ isBusy: false, startCall: async () => {} });' }));
  await page.route('**/src/data-access/m3-messaging/messageReportRepository.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `export const messageReportRepository = { invoke: async body => { window.lastReport = body; if (window.failReport) throw new Error('Evidence could not be saved. Please retry.'); return {ok:true}; } };` }));
  await page.route('**/__message-reports*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('/src/main.jsx', '/tests/e2e/fixtures/chat-performance.jsx') });
  });
  await page.goto('/__message-reports');
  await expect(page.getByRole('button', { name: 'Open camera options' })).toBeVisible();
  await page.evaluate(() => window.appendChatMessage());
  await page.locator('#message-incoming-200 summary').click();
  await page.getByRole('button', { name: 'Report message', exact: true }).click();
});

test('received message report submits independently of delete-for-me', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Report message' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Reason', { exact: true }).selectOption('Violence or threats');
  await page.getByLabel('Additional details (optional)').fill('Threatening message');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByRole('status')).toContainText('Report received');
  expect(await page.evaluate(() => window.lastReport)).toEqual({ action: 'submit', messageId: 'incoming-200', reason: 'Violence or threats: Threatening message' });
  expect(await page.evaluate(() => window.chatMetrics.deletes)).toBe(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed evidence save preserves input and allows retry', async ({ page }) => {
  await page.evaluate(() => { window.failReport = true; });
  await page.getByLabel('Additional details (optional)').fill('Keep this explanation');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByRole('alert')).toContainText('Evidence could not be saved');
  await expect(page.getByLabel('Additional details (optional)')).toHaveValue('Keep this explanation');
  await page.evaluate(() => { window.failReport = false; });
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByRole('status')).toContainText('Report received');
});
