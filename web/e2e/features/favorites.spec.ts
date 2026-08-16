import { test, expect } from "@playwright/test";
import { TEST_ZIPS } from "../helpers/test-data";
import { searchZip, buildingCards } from "../helpers/navigation";

// Spec 021's declared Verification Oracle: clicking the save button on a
// BuildingCard toggles its visual state and the building subsequently
// appears on /favorites; clicking unsave on /favorites removes it from the
// list. Credential-blocked pattern (matches spec 016's Stripe-integration
// E2E note / auth.spec.ts's own precedent): no real Firebase project or
// test account exists in this environment yet, so the round-trip
// assertions (which require a genuinely logged-in session, since the save
// button's fetch to /api/favorites needs a real session cookie to succeed
// rather than 401) are skipped, not faked. The sign-in-prompt assertion for
// a logged-out click needs no real account and runs unconditionally.
const PLACEHOLDER_MARKERS = ["YOUR-", "PROJECT-ID", "your_firebase", "[", "]"];

function isFirebaseClientApiKeyPlaceholder(apiKey: string | undefined): boolean {
  if (!apiKey || apiKey.trim().length === 0) return true;
  return PLACEHOLDER_MARKERS.some((marker) => apiKey.includes(marker));
}

const firebaseClientApiKeyIsPlaceholder = isFirebaseClientApiKeyPlaceholder(
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY
);
const FIREBASE_CREDENTIAL_SKIP_REASON =
  "NEXT_PUBLIC_FIREBASE_API_KEY is not configured with a real Firebase project — no test account available to complete a real sign-in flow, so a save request can never actually succeed (server-side verifySessionCookie() always rejects) in this environment.";

test.describe("Favorites (spec 021)", () => {
  test("an unauthenticated request to /favorites redirects to /login", async ({ page }) => {
    const response = await page.goto("/favorites");
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });

  test("clicking the save button while logged out shows a sign-in prompt instead of silently failing", async ({
    page,
  }) => {
    // Exercises the client-side-only UX nicety (useAuth().user === null ->
    // "Sign in to save" prompt) — no real account needed, since a logged-out
    // user never even reaches the network call (spec 021 Edge Cases).
    await page.goto("/");
    await searchZip(page, TEST_ZIPS.LOADED);
    const firstCard = buildingCards(page).first();
    await expect(firstCard).toBeVisible();

    const saveButton = page
      .locator('[data-testid="building-card-toggle"]')
      .first()
      .locator("xpath=..")
      .getByRole("button", { name: /save building/i });
    await saveButton.click();

    await expect(page.getByText(/sign in to save/i)).toBeVisible();
  });

  test("saving a building on the search results page makes it appear on /favorites, and unsaving on /favorites removes it", async ({
    page,
  }) => {
    test.skip(firebaseClientApiKeyIsPlaceholder, FIREBASE_CREDENTIAL_SKIP_REASON);

    // Requires a real, already-authenticated browser context (a signed-in
    // Firebase test account provisioned out-of-band via
    // TEST_FIREBASE_EMAIL/TEST_FIREBASE_PASSWORD, same as auth.spec.ts) —
    // unreachable in this environment, gated above by test.skip.
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.TEST_FIREBASE_EMAIL ?? "");
    await page.getByLabel("Password").fill(process.env.TEST_FIREBASE_PASSWORD ?? "");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/\/login/);

    await page.goto("/");
    await searchZip(page, TEST_ZIPS.LOADED);
    const firstCard = buildingCards(page).first();
    await expect(firstCard).toBeVisible();
    const addressText = await firstCard.locator("h3").innerText();

    const saveButton = firstCard.locator("xpath=..").getByRole("button", { name: /save building/i });
    await saveButton.click();
    await expect(
      firstCard.locator("xpath=..").getByRole("button", { name: /remove from favorites/i })
    ).toBeVisible();

    await page.goto("/favorites");
    await expect(page.getByText(addressText)).toBeVisible();

    const unsaveButton = page.getByRole("button", { name: /remove from favorites/i }).first();
    await unsaveButton.click();
    await expect(page.getByText(addressText)).not.toBeVisible();
    await expect(page.getByText(/no saved buildings or landlords yet/i)).toBeVisible();
  });
});
