import { test, expect } from '@playwright/test';

test.describe('AirGap App', () => {
    test('should load the main page', async ({ page }) => {
        await page.goto('/');

        // Check title
        await expect(page).toHaveTitle(/AirGap/);

        // Check main heading
        await expect(page.locator('h1')).toContainText('AirGap');

        // Check mode buttons exist
        await expect(page.getByRole('button', { name: /send/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /receive/i })).toBeVisible();
    });

    test('should navigate to send mode', async ({ page }) => {
        await page.goto('/');

        await page.getByRole('button', { name: /send/i }).click();

        // Check we're in send mode
        await expect(page.locator('text=Send File')).toBeVisible();
    });

    test('should navigate to receive mode', async ({ page }) => {
        await page.goto('/');

        await page.getByRole('button', { name: /receive/i }).click();

        // Check we're in receive mode
        await expect(page.locator('text=Receive File')).toBeVisible();
    });

    test('should show encryption badge', async ({ page }) => {
        await page.goto('/');

        // Check encryption badge is visible
        await expect(page.locator('text=Encrypted')).toBeVisible();
    });
});
