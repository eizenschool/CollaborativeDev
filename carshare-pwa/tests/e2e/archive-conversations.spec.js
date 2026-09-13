import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  const scope = testInfo.title.includes('friend') ? 'friend' : 'ride';
  await page.addInitScript(value => { window.archiveTestScope = value; }, scope);
  await page.route('**/src/presentation/shared/context/AuthContext.jsx', route => route.fulfill({
    contentType: 'application/javascript', body: 'export const useAuth = () => ({ user: { id: "me" } });',
  }));
  await page.route('**/src/presentation/m3-messaging/components/ChatWindow.jsx', route => route.fulfill({
    contentType: 'application/javascript', body: `import React from '/node_modules/.vite/deps/react.js'; export default function Chat({onManage}) { return React.createElement('button', {onClick: () => onManage(window.archiveFixture.conversation)}, 'Manage opened chat'); }`,
  }));
  await page.route('**/message', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('/src/main.jsx', '/tests/e2e/fixtures/archive-conversations.jsx') });
  });
  await page.goto('/message');
  if (scope === 'friend') await page.getByRole('tab', { name: /Friend messages/ }).click();
  await page.getByRole('button', { name: 'Open conversation with Ahmad', exact: true }).click();
  await page.getByRole('button', { name: 'Manage opened chat' }).click();
});

test('friend archive immediately reduces count to zero despite delayed and stale refreshes', async ({ page }) => {
  await page.evaluate(() => window.archiveFixture.holdRefresh());
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page).toHaveURL(/\/message$/);
  await expect(page.getByRole('tab', { name: /Friend messages/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /Friend messages/ })).toHaveText('Friend messages0');
  await expect(page.getByRole('button', { name: 'View', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open conversation with Ahmad', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.archiveFixture.releaseStale());
  await expect(page.getByRole('tab', { name: /Friend messages/ })).toHaveText('Friend messages0');
  await expect(page.getByRole('button', { name: 'Open conversation with Ahmad', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.archiveFixture.releaseAll());
  await page.getByRole('button', { name: 'Open archived conversations' }).click();
  await expect(page.getByRole('heading', { name: 'Archived', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Friend messages/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Open conversation with Ahmad', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to active conversations' }).click();
  await expect(page.getByRole('tab', { name: /Friend messages/ })).toHaveAttribute('aria-selected', 'true');
});

test('archive returns to Messages without a View action', async ({ page, viewport }) => {
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page).toHaveURL(/\/message$/);
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Conversation archived');
  await expect(page.getByRole('button', { name: 'Open conversation with Ahmad', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage opened chat' })).toHaveCount(0);
  if (viewport.width > 900) await expect(page.getByRole('heading', { name: 'Select a conversation' })).toBeVisible();
  const notice = await page.locator('.message-archive-notice').boundingBox();
  expect(notice.x).toBeGreaterThanOrEqual(0);
  expect(notice.x + notice.width).toBeLessThanOrEqual(viewport.width);
  expect(notice.y + notice.height).toBeLessThanOrEqual(viewport.height - (viewport.width <= 700 ? 64 : 0));
  await expect(page.getByRole('button', { name: 'View', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open archived conversations' }).click();
  await expect(page.getByRole('heading', { name: 'Archived', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open conversation with Ahmad', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage opened chat' })).toHaveCount(0);
});

test('archive failure keeps the chat and management error available', async ({ page }) => {
  await page.evaluate(() => { window.archiveFixture.fail = true; });
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Unable to archive conversation.');
  await expect(page).toHaveURL(/\/message\/archive-chat$/);
  await expect(page.locator('.message-archive-notice')).toHaveCount(0);
});
