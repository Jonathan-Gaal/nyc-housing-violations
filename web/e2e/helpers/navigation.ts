import type { Locator, Page } from "@playwright/test";

// Page-Object-lite helper functions (plain async functions, not a class
// hierarchy) matching context/product/open-violation-e2e-testing-setup.md
// §1.5's "Test Helpers" convention. Written against the real single-page,
// card-based DOM (web/app/page.tsx, web/components/BuildingCard.tsx) — not
// the source doc's illustrative table-based / URL-routed example markup.

/**
 * Enters the given zip code into the search input and submits the form.
 * Does not wait for results — callers should assert on the resulting state
 * (summary cards, error message, or empty state) using Playwright's
 * auto-retrying `expect(locator).toBeVisible()`.
 */
export async function searchZip(page: Page, zip: string): Promise<void> {
  const zipInput = page.getByLabel("Zip, street, or address");
  await zipInput.fill(zip);
  await page.getByRole("button", { name: /search/i }).click();
}

/**
 * Returns the locator for all rendered building cards, in DOM order (which
 * matches API response order — worst-first, per web/lib/scoring.ts).
 */
export function buildingCards(page: Page): Locator {
  // Scoped on BuildingCard.tsx's data-testid, not its element tag/role —
  // the toggle is a role="button" div (not a real <button>) so a real
  // <button> can be nested inside it (the rent-impairing filter button),
  // which isn't valid HTML for button-in-button.
  return page.locator('[data-testid="building-card-toggle"]');
}

/**
 * Clicks the first rendered building card to expand it, and waits for the
 * expanded content (the entrance-grouped violation list) to become visible.
 */
export async function expandFirstBuilding(page: Page): Promise<Locator> {
  const firstCard = buildingCards(page).first();
  await firstCard.click();
  const expandedCardContainer = firstCard.locator("xpath=..");
  await expandedCardContainer
    .getByText(/^entrance /i)
    .first()
    .waitFor({ state: "visible" });
  return expandedCardContainer;
}
