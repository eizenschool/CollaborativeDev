import { expect, test } from '@playwright/test';

test('deleted chat is searchable without old history, including stale refresh responses', async ({ page }) => {
  await page.route('**/src/presentation/shared/context/AuthContext.jsx', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'export const useAuth = () => ({ user: { id: "me" } });',
  }));
  await page.route('**/__deleted-conversations', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('/src/main.jsx', '/tests/e2e/fixtures/deleted-conversations.jsx') });
  });
  await page.goto('/__deleted-conversations');
  await page.getByRole('tab', { name: /Friend messages/ }).click();
  const chat = page.getByRole('button', { name: 'Open conversation with Ahmad', exact: true });
  await expect(chat).toBeVisible();
  await chat.click();
  await expect(page.getByRole('region', { name: 'Opened conversation' })).toContainText('Old secret');
  await page.evaluate(() => window.deletedChatTest.startSlowRefresh());
  await expect.poll(() => page.evaluate(() => window.deletedChatTest.pending())).toBe(2);
  await page.getByRole('button', { name: 'Delete fixture conversation' }).click();
  await expect(chat).toHaveCount(0);
  await page.evaluate(() => window.deletedChatTest.release());
  const search = page.getByRole('searchbox', { name: 'Search conversations' });
  await search.fill('Old secret');
  await expect(chat).toHaveCount(0);
  await search.fill('ahmad');
  await expect(chat).toContainText('History deleted');
  await expect(page.getByRole('tab', { name: /Friend messages/ })).toContainText('0');
  await chat.click();
  await expect(page.getByRole('region', { name: 'Opened conversation' })).toContainText('Ahmad');
  await expect(page.getByText('Old secret', { exact: true })).toHaveCount(0);
  await search.fill('');
  await expect(chat).toHaveCount(0);
  await page.evaluate(() => window.deletedChatTest.newMessage());
  await expect(chat).toContainText('Hello again');
  await expect(page.getByRole('region', { name: 'Opened conversation' })).toContainText('Hello again');
  await expect(page.getByText('Old secret', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete fixture conversation' }).click();
  await expect(chat).toHaveCount(0);
  await search.fill('Ahmad');
  await expect(chat).toContainText('History deleted');
  await chat.click();
  await expect(page.getByText('Hello again', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
