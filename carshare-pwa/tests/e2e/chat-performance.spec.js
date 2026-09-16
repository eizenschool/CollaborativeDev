import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test.beforeEach(async ({ page }) => {
  await page.route('**/src/presentation/m3-messaging/context/MessagingSessionContext.jsx', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'export const useMessagingSession = () => window.chatTestSession;',
  }));
  await page.route('**/src/presentation/m3-messaging/context/CallSessionContext.jsx', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'export const useCallSession = () => ({ isBusy: false, startCall: async () => {} });',
  }));
  await page.route('**/__chat-performance*', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace('/src/main.jsx', '/tests/e2e/fixtures/chat-performance.jsx');
    await route.fulfill({ response, body: html });
  });
  await page.goto('/__chat-performance');
  await expect(page.getByRole('button', { name: 'Open camera options' })).toBeVisible();
});

test('phone composer stays above navigation, including a multiline draft', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('phone'), 'Phone app shell.');
  await page.goto('/__chat-performance?shell=1');
  const composer = page.locator('.message-composer');
  await expect(composer).toBeVisible();
  const checkBounds = async () => {
    const navTop = await page.locator('.topnav').evaluate(e => e.getBoundingClientRect().top);
    const composerBottom = await composer.evaluate(e => e.getBoundingClientRect().bottom);
    expect(composerBottom).toBeLessThanOrEqual(navTop + 1);
    await expect(page.locator('textarea')).toBeInViewport({ ratio: 1 });
  };
  await checkBounds();
  await page.locator('textarea').fill('First line\nSecond line\nThird line\nFourth line');
  await checkBounds();
  await page.setViewportSize({ width: 375, height: 560 });
  await checkBounds();
});

test('opens at latest messages and offers an arrow after scrolling into history', async ({ page }) => {
  const scroll = page.locator('.message-chat-scroll');
  const arrow = page.getByRole('button', { name: 'Scroll to latest messages' });
  const bottomGap = () => scroll.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
  await expect.poll(bottomGap).toBeLessThan(2);
  await expect(arrow).toBeHidden();
  await scroll.evaluate((element) => { element.scrollTop = 0; });
  await expect(arrow).toBeVisible();
  await page.evaluate(() => window.appendChatMessage());
  await expect(page.locator('#message-incoming-200')).toHaveCount(1);
  await page.locator('textarea').fill('Draft while reading history');
  await expect(scroll).toHaveJSProperty('scrollTop', 0);
  await arrow.click();
  await expect.poll(bottomGap).toBeLessThan(2);
  await expect(arrow).toBeHidden();
  await page.evaluate(() => window.appendChatMessage());
  await expect(page.locator('#message-incoming-201')).toHaveCount(1);
  await expect.poll(bottomGap).toBeLessThan(2);
});

test('keeps the latest message visible when layout changes before the resize callback', async ({ page }) => {
  const scroll = page.locator('.message-chat-scroll');
  const gap = () => scroll.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
  await expect.poll(gap).toBeLessThan(2);
  await scroll.evaluate((element) => {
    // A late media layout/browser scroll event can precede ResizeObserver delivery.
    element.querySelector('#message-message-199').style.minHeight = '450px';
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(gap).toBeLessThan(2);
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
  await lastMessage.locator('summary').click();
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

test('deleted messages align with the same sender’s normal message column', async ({ page }, testInfo) => {
  for (const other of [false, true]) {
    await page.goto(`/__chat-performance?tombstone=1${other ? '&other=1' : ''}`);
    const deleted = page.locator('#message-message-199');
    const normal = page.locator('#message-message-198');
    await expect(deleted).toContainText('Message deleted');
    for (const selector of ['.message-bubble-avatar', '.message-bubble-column', '.message-bubble-meta']) {
      const a = await deleted.locator(selector).boundingBox();
      const b = await normal.locator(selector).boundingBox();
      expect(a).not.toBeNull(); expect(b).not.toBeNull();
      const edge = (box) => other ? box.x : box.x + box.width;
      expect(Math.abs(edge(a) - edge(b))).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`deleted-${other ? 'received' : 'sent'}.png`) });
  }
});

test('personal deletion keeps a shared tombstone hidden while history refresh is pending', async ({ page }) => {
  await page.goto('/__chat-performance?tombstone=1');
  const last = page.locator('#message-message-199');
  await expect(last).toContainText('Message deleted');
  await page.evaluate(() => { window.chatMutation.delayed = true; });
  await last.locator('summary').click();
  await last.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete for me', exact: true }).click();
  await expect(last).toHaveCount(0);
  await page.evaluate(() => window.chatMutation.finish(false));
  await expect(last).toContainText('Message deleted');
  await last.locator('summary').click();
  await last.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete for me', exact: true }).click();
  await page.evaluate(() => window.chatMutation.finish(true));
  await expect(page.getByRole('button', { name: 'Open camera options' })).toBeEnabled();
  await expect(last).toHaveCount(0);
  // Re-render while the fixture still holds the old server tombstone.
  await page.locator('textarea').fill('Another draft');
  await expect(last).toHaveCount(0);
});

test('edit responds before confirmation, rolls back failure and keeps the draft for retry', async ({ page }) => {
  await page.evaluate(() => { window.chatMutation.delayed = true; });
  const last = page.locator('#message-message-199');
  await last.locator('summary').click();
  await last.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('textarea').fill('Instant edit');
  await page.getByRole('button', { name: 'Save edited message' }).click();
  await expect(last).toContainText('Instant edit');
  await expect(last).toContainText('Saving…');
  await page.evaluate(() => window.chatMutation.finish(false));
  await expect(last).toContainText('Message 199');
  await expect(page.locator('textarea')).toHaveValue('Instant edit');
  await expect(page.getByRole('alert')).toContainText('Request failed');
  await page.getByRole('button', { name: 'Save edited message' }).click();
  await page.evaluate(() => window.chatMutation.finish(true));
  await expect(last).toContainText('Instant edit');
  await expect(last).not.toContainText('Saving…');
});

for (const scope of ['me', 'everyone']) {
  test(`delete for ${scope} responds immediately and rolls back a rejection`, async ({ page }) => {
    await page.evaluate(() => { window.chatMutation.delayed = true; });
    const last = page.locator('#message-message-199');
    await last.locator('summary').click();
    await last.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: `Delete for ${scope}`, exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Delete this message?' })).toHaveCount(0);
    if (scope === 'me') await expect(last).toHaveCount(0);
    else await expect(last).toContainText('Deleting…');
    await page.evaluate(() => window.chatMutation.finish(false));
    await expect(last).toContainText('Message 199');
    await expect(page.getByRole('alert')).toContainText('Request failed');
    if (!(await last.locator('details').evaluate((element) => element.open))) await last.locator('summary').click();
    await last.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: `Delete for ${scope}`, exact: true }).click();
    await page.evaluate(() => window.chatMutation.finish(true));
    if (scope === 'me') await expect(last).toHaveCount(0);
    else await expect(last).toContainText('Message deleted');
  });
}
