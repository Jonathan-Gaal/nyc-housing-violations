import { test, expect } from "@playwright/test";

// Spec 015's own declared Verification Oracle: a Playwright test asserting
// (a) unauthenticated access to a protected route redirects to /login,
// (b)-(d) after a real sign-in, document.cookie/localStorage never expose
// the raw token and GET /api/auth/me returns the profile. Not in spec 015's
// Files list (5, "at cap") but explicitly required by its own Verification
// Oracle / E2E Test Constraints sections — same precedent as
// app/api/cron/sync/route.test.ts (specs/008) being added beyond that
// spec's Files list because its own Verification Oracle required it.
//
// Credential-blocked pattern (matches pgClient.test.ts's
// isDatabaseUrlPlaceholder / firebaseAdmin.test.ts's
// isFirebaseAdminSdkKeyPlaceholder): no real Firebase project or test
// account exists in this environment yet — NEXT_PUBLIC_FIREBASE_API_KEY is
// absent from web/.env.local entirely. Assertion (a) (middleware redirect)
// needs no real Firebase account and runs unconditionally. Assertions
// (b)-(d) require actually completing a sign-in against a real Firebase
// project and are skipped, not faked, until a test account is configured.
const PLACEHOLDER_MARKERS = ["YOUR-", "PROJECT-ID", "your_firebase", "[", "]"];

function isFirebaseClientApiKeyPlaceholder(apiKey: string | undefined): boolean {
  if (!apiKey || apiKey.trim().length === 0) return true;
  return PLACEHOLDER_MARKERS.some((marker) => apiKey.includes(marker));
}

const firebaseClientApiKeyIsPlaceholder = isFirebaseClientApiKeyPlaceholder(
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY
);
const FIREBASE_CREDENTIAL_SKIP_REASON =
  "NEXT_PUBLIC_FIREBASE_API_KEY is not configured with a real Firebase project — no test account available to complete a real sign-in flow.";

test.describe("Auth", () => {
  test("an unauthenticated request to a protected route redirects to /login", async ({ page }) => {
    const response = await page.goto("/dashboard");
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });

  test("after sign-in, document.cookie does not expose a readable session token", async ({ page }) => {
    test.skip(firebaseClientApiKeyIsPlaceholder, FIREBASE_CREDENTIAL_SKIP_REASON);

    // Requires a real Firebase test account (email/password) provisioned
    // out-of-band; TEST_FIREBASE_EMAIL/TEST_FIREBASE_PASSWORD are not set in
    // this environment, so this body is unreachable until that account
    // exists — test.skip above already gates on the underlying credential.
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.TEST_FIREBASE_EMAIL ?? "");
    await page.getByLabel("Password").fill(process.env.TEST_FIREBASE_PASSWORD ?? "");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/\/login/);

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === "session");
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);

    // A JS-readable document.cookie check is precisely how this spec proves
    // httpOnly is actually set, not just claimed (spec 015 Verification
    // Oracle (b)).
    const readableCookieString = await page.evaluate(() => document.cookie);
    expect(readableCookieString).not.toContain("session=");
  });

  test("after sign-in, localStorage never contains the raw Firebase ID token", async ({ page }) => {
    test.skip(firebaseClientApiKeyIsPlaceholder, FIREBASE_CREDENTIAL_SKIP_REASON);

    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.TEST_FIREBASE_EMAIL ?? "");
    await page.getByLabel("Password").fill(process.env.TEST_FIREBASE_PASSWORD ?? "");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/\/login/);

    // Directly disproves the source doc's rejected pattern
    // (localStorage.setItem('firebaseAuthToken', token)) was followed —
    // spec 015 Verification Oracle (c).
    const firebaseAuthTokenValue = await page.evaluate(() => localStorage.getItem("firebaseAuthToken"));
    expect(firebaseAuthTokenValue).toBeNull();

    const allLocalStorageEntries = await page.evaluate(() => ({ ...localStorage }));
    const suspiciousKeys = Object.keys(allLocalStorageEntries).filter((key) =>
      /token/i.test(key)
    );
    expect(suspiciousKeys).toEqual([]);
  });

  test("GET /api/auth/me returns the signed-in user's profile after successful login", async ({ page }) => {
    test.skip(firebaseClientApiKeyIsPlaceholder, FIREBASE_CREDENTIAL_SKIP_REASON);

    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.TEST_FIREBASE_EMAIL ?? "");
    await page.getByLabel("Password").fill(process.env.TEST_FIREBASE_PASSWORD ?? "");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/\/login/);

    const meResponse = await page.request.get("/api/auth/me");
    expect(meResponse.ok()).toBe(true);

    const profile = (await meResponse.json()) as { uid: string; email: string; tier: string };
    expect(profile.email).toBe(process.env.TEST_FIREBASE_EMAIL);
    expect(typeof profile.uid).toBe("string");
    expect(profile.uid.length).toBeGreaterThan(0);
  });
});
