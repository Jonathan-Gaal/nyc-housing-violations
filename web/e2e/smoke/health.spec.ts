import { test, expect } from "@playwright/test";

// Basic sanity check per specs/011-playwright-setup.md: proves the dev
// server boots, a browser launches, and the home page loads with the
// zip-search input visible. Deliberately the only Playwright test added by
// this spec — feature-level E2E specs (zip search, building detail) are
// Phase 9 (specs/012-playwright-feature-specs.md).
test.describe("Health check", () => {
  test("home page loads and zip-search input is visible", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /know before you sign the lease/i })).toBeVisible();

    const zipInput = page.getByPlaceholder(/enter a zip code/i);
    await expect(zipInput).toBeVisible();
  });
});
