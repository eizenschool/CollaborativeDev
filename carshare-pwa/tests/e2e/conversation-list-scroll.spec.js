import { expect, test } from '@playwright/test';
for (const count of [4, 5, 6]) {
  test(`${count} conversations remain reachable above the phone navigation`, async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('phone'), 'Phone navigation layout.');
    await page.route('**/__conversation-scroll?*', async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace('/src/main.jsx', '/tests/e2e/fixtures/conversation-scroll.jsx');
      await route.fulfill({ response, body: html });
    });
    await page.goto(`/__conversation-scroll?count=${count}`);
    const last = page.locator('.message-conversation-row').last();
    await expect(last).toBeVisible();
    await page.locator('.message-conversation-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const bottom = await last.evaluate((element) => element.getBoundingClientRect().bottom);
    const navTop = await page.locator('.topnav').evaluate((element) => element.getBoundingClientRect().top);
    expect(bottom).toBeLessThanOrEqual(navTop + 1);
    await expect(last.getByRole('button', { name: /Conversation details/ })).toBeInViewport({ ratio: 1 });
  });
}
