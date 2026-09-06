import { expect, test } from '@playwright/test';

const key = 'letstumpang_mock_db_v1';
const photo = { name: 'document.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };

async function setup(page, noVehicles) {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Where should you go?' })).toBeVisible();
  await page.evaluate(({ key, noVehicles }) => {
    const db = JSON.parse(localStorage.getItem(key));
    db.identityVerifications = {};
    if (noVehicles) db.vehicles[db.currentUserId] = [];
    db.rides.r_5.status = 'Draft';
    localStorage.setItem(key, JSON.stringify(db));
  }, { key, noVehicles });
}
test('new driver completes documents before creating a vehicle', async ({ page }) => {
  await setup(page, true);
  await page.goto('/ride/publish');
  await expect(page.getByRole('heading', { name: 'Add a vehicle before publishing a ride.' })).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Vehicle', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Vehicles', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Vehicle', exact: true }).click();
  await page.getByRole('button', { name: 'Save driver documents' }).click();
  await expect(page.getByText('Please correct the highlighted document fields.')).toBeFocused();
  await page.getByLabel('MyKad number (required)').fill('990101145678');
  await page.getByLabel('MyKad photo (required)', { exact: true }).setInputFiles(photo);
  await page.getByLabel('Driving licence expiry (required)').fill('2099-12-31');
  await page.getByLabel('Driving licence photo (required)', { exact: true }).setInputFiles(photo);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('driver-documents.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save driver documents' }).click();
  await expect(page.getByText('Step 2 of 2: Add Vehicle')).toBeVisible();
  const inputs = page.locator('form .field input');
  await inputs.nth(0).fill('Perodua');
  await inputs.nth(1).fill('Myvi');
  await page.locator('form select').selectOption({ index: 1 });
  await inputs.nth(2).fill('TEST1234');
  await page.getByRole('button', { name: 'Save Vehicle', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue to Publish Ride' })).toBeVisible();
  await page.getByRole('button', { name: 'Add Vehicle', exact: true }).click();
  await expect(page.getByText('Step 2 of 2: Add Vehicle')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save driver documents' })).toHaveCount(0);
});

test('passenger can submit IC without a licence and existing driver can supplement it', async ({ page }) => {
  await setup(page, false);
  await page.goto('/profile?panel=info');
  await page.getByRole('button', { name: 'Update my documents' }).click();
  await expect(page.getByLabel('Driving licence expiry (required)')).toHaveCount(0);
  await page.getByLabel('MyKad number (required)').fill('880505081234');
  await page.getByLabel('MyKad photo (required)', { exact: true }).setInputFiles(photo);
  await page.getByRole('button', { name: 'Submit MyKad' }).click();
  await expect(page.getByText('Documents submitted. Awaiting review.')).toBeVisible();
  await page.goto('/ride/r_5/publish');
  await expect(page.getByRole('heading', { name: 'Complete your driver documents before publishing' })).toBeVisible();
  await page.getByRole('button', { name: 'Complete driver documents' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My Vehicles', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Complete driver documents' }).click();
  await expect(page.getByLabel('MyKad number (required)')).toHaveValue('880505-08-1234');
  await expect(page.getByLabel('MyKad photo (optional replacement)', { exact: true })).toBeVisible();
  await page.getByLabel('Driving licence expiry (required)').fill('2099-12-31');
  await page.getByLabel('Driving licence photo (required)', { exact: true }).setInputFiles(photo);
  await page.getByRole('button', { name: 'Save driver documents' }).click();
  await page.getByRole('button', { name: 'Continue to Publish Ride' }).click();
  await expect(page).toHaveURL(/\/ride\/r_5\/publish$/);
  await expect(page.getByRole('combobox', { name: 'Pickup point', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Pickup point', exact: true })).toHaveValue('Bangsar LRT, Kuala Lumpur');
  await expect(page.getByRole('heading', { name: 'Complete your driver documents before publishing' })).toHaveCount(0);
});
