import { test, expect } from "@playwright/test";
import { isDatabaseUrlPlaceholder } from "@/lib/pgClient";
import { TEST_ZIPS } from "../helpers/test-data";
import { searchZip, buildingCards } from "../helpers/navigation";

// US-1/US-2/US-3 acceptance criteria: zip input visibility, validation
// error surfacing, and worst-first building results — asserted against the
// real card-based DOM (web/app/page.tsx), not the source doc's illustrative
// table markup. See specs/012-playwright-feature-specs.md.
//
// Credential-blocked pattern (matches lib/queries.test.ts,
// lib/loadIntoDb.test.ts): live-data-dependent assertions are skipped, not
// failed, while DATABASE_URL is still the web/.env.example placeholder —
// there is no seeded zip-11106 fixture to search against in that state.
// The skip check is called inside each test body (not at describe scope)
// so it only affects the individual test it's declared in.
const databaseUrlIsPlaceholder = isDatabaseUrlPlaceholder(process.env.DATABASE_URL);
const DATABASE_PLACEHOLDER_SKIP_REASON =
  "DATABASE_URL is still the web/.env.example placeholder — no seeded zip-11106 fixture to search against.";

test.describe("Zip search", () => {
  test("zip input is visible on load", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Zip code")).toBeVisible();
  });

  test("entering a non-5-digit zip shows a validation error", async ({ page }) => {
    await page.goto("/");
    await searchZip(page, TEST_ZIPS.INVALID);

    await expect(page.getByText(/zip code must be 5 digits/i)).toBeVisible();
  });

  test("a valid zip with known data shows summary stats and building cards", async ({ page }) => {
    test.skip(databaseUrlIsPlaceholder, DATABASE_PLACEHOLDER_SKIP_REASON);

    await page.goto("/");
    await searchZip(page, TEST_ZIPS.LOADED);

    await expect(page.getByText(/open violations/i)).toBeVisible();
    await expect(page.getByText(/worst-rated buildings/i)).toBeVisible();
    await expect(buildingCards(page).first()).toBeVisible();
  });

  test("a valid zip with no data shows the empty state, not an error", async ({ page }) => {
    test.skip(databaseUrlIsPlaceholder, DATABASE_PLACEHOLDER_SKIP_REASON);

    await page.goto("/");
    await searchZip(page, TEST_ZIPS.EMPTY);

    await expect(page.getByText(/no open violations found/i)).toBeVisible();
  });

  test("building cards render in worst-first order", async ({ page }) => {
    test.skip(databaseUrlIsPlaceholder, DATABASE_PLACEHOLDER_SKIP_REASON);

    await page.goto("/");
    await searchZip(page, TEST_ZIPS.LOADED);

    const cards = buildingCards(page);
    await expect(cards.first()).toBeVisible();

    const cardCount = await cards.count();
    test.skip(cardCount < 2, "Fewer than two buildings returned for this zip; cannot compare order.");

    // RatingBadge renders "{rating.toFixed(1)} · {label}" — extract the
    // leading numeric rating from the first two cards and assert
    // non-increasing order (worst/lowest rating first).
    const firstCardText = await cards.nth(0).innerText();
    const secondCardText = await cards.nth(1).innerText();

    const firstRatingMatch = firstCardText.match(/(\d+(?:\.\d+)?)\s*·/);
    const secondRatingMatch = secondCardText.match(/(\d+(?:\.\d+)?)\s*·/);

    expect(firstRatingMatch).not.toBeNull();
    expect(secondRatingMatch).not.toBeNull();

    const firstRating = Number(firstRatingMatch?.[1]);
    const secondRating = Number(secondRatingMatch?.[1]);

    expect(firstRating).toBeLessThanOrEqual(secondRating);
  });
});
