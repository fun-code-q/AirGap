import { test, expect } from '@playwright/test';

test.describe('AirGap App', () => {
    test('should load the main page', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        // Check title
        await expect(page).toHaveTitle(/AirGap/);

        // Check main heading
        await expect(page.locator('h1')).toContainText('AirGap', { timeout: 15000 });

        // Check mode buttons exist
        await expect(page.getByRole('button', { name: /broadcast/i })).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('button', { name: /capture/i })).toBeVisible({ timeout: 15000 });
    });

    test('should navigate to send mode', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await page.getByRole('button', { name: /broadcast/i }).click({ timeout: 15000 });

        // Check we're in send mode
        await expect(page.locator('h1').filter({ hasText: 'Broadcast' })).toBeVisible({ timeout: 15000 });
        await expect(page.locator('text=Select assets')).toBeVisible({ timeout: 15000 });
    });

    test('should navigate to receive mode', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await page.getByRole('button', { name: /capture/i }).click({ timeout: 15000 });

        // Check we're in receive mode
        await expect(page.locator('h1').filter({ hasText: 'Capture' })).toBeVisible({ timeout: 15000 });
    });

    test('should show encryption badge', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        // Check encryption badge is visible
        await expect(page.locator('text=AES-GCM verified')).toBeVisible({ timeout: 15000 });
    });
});
