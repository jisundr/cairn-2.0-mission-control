import { expect, test } from "@playwright/test";

// Regression coverage for the bug that motivated adding real-browser e2e
// at all: WarningBanner's AlertTriangleIcon rendered unconstrained
// (~800px, filling most of the viewport) instead of a small glyph, because
// no mockup depicts a usage-limit event and jsdom's unit tests don't do
// real CSS layout - only a real browser renders the icon at its actual
// laid-out size. fixtures/seed.py seeds e2e-session-main with exactly one
// usage-limit event so this banner renders against the populated fixture.

test("usage-limit banner's warning icon renders at a bounded size, not unconstrained", async ({ page }) => {
  await page.goto("/");

  const banner = page.getByTestId("usage-limit-banner");
  await expect(banner).toBeVisible();

  const icon = banner.locator("svg");
  await expect(icon).toBeVisible();
  const box = await icon.boundingBox();
  expect(box).not.toBeNull();
  // WarningBanner passes size={14} explicitly; a generous ceiling (well
  // under the ~800px the unconstrained bug produced) so this stays a
  // regression test for "unconstrained," not a pixel-exact size assertion.
  expect(box!.width).toBeLessThanOrEqual(24);
  expect(box!.height).toBeLessThanOrEqual(24);
});
