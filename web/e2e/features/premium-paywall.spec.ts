import { test, expect } from "@playwright/test";

// spec 020's Verification Oracle: the paywall card renders with the correct
// CTA link target and exact button text for a mocked free-tier/signed-out
// session on /landlord and /favorites. Provable entirely via Playwright's
// route interception (page.route) mocking /api/auth/me and /api/landlord or
// /api/favorites's responses directly — no live Firebase/Supabase
// credentials needed, since the paywall only depends on the shape of those
// two responses, not on genuinely authenticating.

async function mockSignedOutSession(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ authenticated: false }) })
  );
}

async function mockSignedInFreeTierSession(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ uid: "free-tier-uid", email: "free@example.com", tier: "free" }),
    })
  );
}

// /favorites is a middleware-protected path (web/middleware.ts's
// PROTECTED_PATHS) — its presence-only cookie check runs before the page
// itself (and this test's own /api/auth/me and /api/favorites mocks) ever
// gets a chance to render. A syntactically-present cookie is sufficient to
// pass that cheap first gate; the mocked /api/auth/me response above is
// what actually determines the page's rendered auth state, matching how
// middleware documents itself as not the real security boundary.
async function setPresenceOnlySessionCookie(page: import("@playwright/test").Page) {
  await page.context().addCookies([
    {
      name: "session",
      value: "e2e-test-cookie-value-for-middleware-presence-check-only",
      domain: "localhost",
      path: "/",
    },
  ]);
}

test.describe("Premium paywall (spec 020)", () => {
  test("signed-out /landlord shows the paywall with exact required copy 'Sign up for Landlord Profile' linking to /signup?intent=premium", async ({
    page,
  }) => {
    await mockSignedOutSession(page);
    await page.route("**/api/landlord**", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ authenticated: false }) })
    );

    await page.goto("/landlord?firstName=Jane&lastName=Doe&officerName=Jane%20Doe");

    const paywallButton = page.getByRole("link", { name: "Sign up for Landlord Profile" });
    await expect(paywallButton).toBeVisible();
    const href = await paywallButton.getAttribute("href");
    expect(href).toMatch(/^\/signup\?intent=premium&callbackUrl=/);
  });

  test("signed-in-but-free-tier /landlord shows the paywall linking to /account/upgrade, not /signup", async ({
    page,
  }) => {
    await mockSignedInFreeTierSession(page);
    await page.route("**/api/landlord**", (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "premium_required" }) })
    );

    await page.goto("/landlord?firstName=Jane&lastName=Doe&officerName=Jane%20Doe");

    const paywallButton = page.getByRole("link", { name: /upgrade to premium/i });
    await expect(paywallButton).toBeVisible();
    const href = await paywallButton.getAttribute("href");
    expect(href).toMatch(/^\/account\/upgrade\?callbackUrl=/);
  });

  test("signed-out /favorites shows the paywall linking to /signup?intent=premium", async ({ page }) => {
    await setPresenceOnlySessionCookie(page);
    await mockSignedOutSession(page);
    await page.route("**/api/favorites", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ authenticated: false }) })
    );

    await page.goto("/favorites");

    const paywallButton = page.getByRole("link", { name: "Sign up for Landlord Profile" });
    await expect(paywallButton).toBeVisible();
    const href = await paywallButton.getAttribute("href");
    expect(href).toMatch(/^\/signup\?intent=premium&callbackUrl=/);
  });

  test("signed-in-but-free-tier /favorites shows the paywall linking to /account/upgrade", async ({ page }) => {
    await setPresenceOnlySessionCookie(page);
    await mockSignedInFreeTierSession(page);
    await page.route("**/api/favorites", (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "premium_required" }) })
    );

    await page.goto("/favorites");

    const paywallButton = page.getByRole("link", { name: /upgrade to premium/i });
    await expect(paywallButton).toBeVisible();
    const href = await paywallButton.getAttribute("href");
    expect(href).toMatch(/^\/account\/upgrade\?callbackUrl=/);
  });
});
