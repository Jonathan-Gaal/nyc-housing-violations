import { test, expect } from "@playwright/test";
import { isDatabaseUrlPlaceholder } from "@/lib/pgClient";
import { TEST_ZIPS } from "../helpers/test-data";
import { searchZip, expandFirstBuilding } from "../helpers/navigation";

// US-4 acceptance criteria: expanding a building card reveals its
// violations grouped by entrance — asserted against BuildingCard.tsx's
// actual toggle()/expanded/byEntrance behavior. There is no per-building
// route/URL in this app today; "detail" means the expanded in-place card,
// not navigation. See specs/012-playwright-feature-specs.md.
//
// Credential-blocked: skipped, not failed, while DATABASE_URL is still the
// web/.env.example placeholder (matches lib/queries.test.ts's gating). The
// skip check is called inside each test body (not at describe scope) so it
// only affects the individual test it's declared in — a bare
// `test.skip(condition, reason)` at describe-body scope in Playwright
// applies to the entire suite regardless of declaration order.
const databaseUrlIsPlaceholder = isDatabaseUrlPlaceholder(process.env.DATABASE_URL);
const DATABASE_PLACEHOLDER_SKIP_REASON =
  "DATABASE_URL is still the web/.env.example placeholder — no seeded zip-11106 fixture to search against.";

test.describe("Building detail (expand/collapse)", () => {
  test("clicking a building card expands it to show violation details", async ({ page }) => {
    test.skip(databaseUrlIsPlaceholder, DATABASE_PLACEHOLDER_SKIP_REASON);

    await page.goto("/");
    await searchZip(page, TEST_ZIPS.LOADED);

    const expandedCard = await expandFirstBuilding(page);
    await expect(expandedCard.getByText(/^entrance /i).first()).toBeVisible();
  });

  test("expanded card groups violation entries by entrance", async ({ page }) => {
    test.skip(databaseUrlIsPlaceholder, DATABASE_PLACEHOLDER_SKIP_REASON);

    await page.goto("/");
    await searchZip(page, TEST_ZIPS.LOADED);

    const expandedCard = await expandFirstBuilding(page);

    // byEntrance groups on house_number, rendered as "Entrance {value}"
    // headings (BuildingCard.tsx) — assert at least one such heading and
    // at least one violation row nested under it.
    const entranceHeadings = expandedCard.getByText(/^entrance /i);
    await expect(entranceHeadings.first()).toBeVisible();
    expect(await entranceHeadings.count()).toBeGreaterThanOrEqual(1);

    const violationRows = expandedCard.locator("ul.divide-y > li");
    expect(await violationRows.count()).toBeGreaterThanOrEqual(1);
  });

  test("clicking an expanded card again collapses it", async ({ page }) => {
    test.skip(databaseUrlIsPlaceholder, DATABASE_PLACEHOLDER_SKIP_REASON);

    await page.goto("/");
    await searchZip(page, TEST_ZIPS.LOADED);

    const expandedCard = await expandFirstBuilding(page);
    const entranceHeading = expandedCard.getByText(/^entrance /i).first();
    await expect(entranceHeading).toBeVisible();

    await expandedCard.getByRole("button").first().click();
    await expect(entranceHeading).not.toBeVisible();
  });
});
