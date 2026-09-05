import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test.beforeEach(async ({ page }) => {
  await page.route('**/src/context/MessagingSessionContext.jsx', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'export const useMessagingSession = () => window.chatTestSession;',
  }));
  await page.route('**/src/context/CallSessionContext.jsx', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'export const useCallSession = () => ({ isBusy: false, startCall: async () => {} });',
  }));
  await page.route('**/__chat-performance', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace('/src/main.jsx', '/tests/e2e/fixtures/chat-performance.jsx');
    await route.fulfill({ response, body: html });
  });
  await page.goto('/__chat-performance');
  await expect(page.getByRole('button', { name: 'Open camera options' })).toBeVisible();
});

test('menus and editing do not redraw 200 messages; a slow refresh does not lock the composer', async ({ page }) => {
  await page.evaluate(() => { window.chatMetrics.messageReads = 0; });
  await page.getByRole('button', { name: 'Open camera options' }).click();
  await expect(page.getByRole('dialog', { name: 'Create media' })).toBeVisible();
  expect(await page.evaluate(() => window.chatMetrics.messageReads)).toBe(0);
  await page.keyboard.press('Escape');
  const lastMessage = page.locator('#message-message-199');
  await lastMessage.locator('summary').click();
  await lastMessage.getByRole('button', { name: 'Edit', exact: true }).click();
  // Reading the chosen message once is expected; rendering the history again is not.
  expect(await page.evaluate(() => window.chatMetrics.messageReads)).toBeLessThan(5);
  await page.getByRole('button', { name: 'Save edited message' }).click();
  await expect(page.getByRole('button', { name: 'Open camera options' })).toBeEnabled();
  expect(await page.evaluate(() => window.chatMetrics.edits)).toBe(1);
  await lastMessage.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete for me', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this message?' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open camera options' })).toBeEnabled();
  expect(await page.evaluate(() => window.chatMetrics.deletes)).toBe(1);
});

test('desktop camera opens and captures after StrictMode effect cleanup', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('phone'), 'Phone uses the native camera picker.');
  await page.getByRole('button', { name: 'Open camera options' }).click();
  await page.getByRole('button', { name: /Take photo/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Take photo' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('video')).toHaveJSProperty('readyState', 4);
  await dialog.getByRole('button', { name: /Take photo|Capture photo/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('img', { name: /photo-.*jpg/ })).toBeVisible();
});
