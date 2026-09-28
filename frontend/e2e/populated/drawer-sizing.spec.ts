import { expect, test } from "@playwright/test";

// Goal 11 / Success criteria (PRD §6.7): the drawer is 3/4 viewport width on
// desktop and full width at <=900px, "verified at both sizes" - jsdom
// (vitest) never evaluates `design.css`'s media query at all, so nothing
// but a real browser can catch a regression here (the same gap
// layout-sanity.spec.ts's own icon-sizing checks exist to close). Opens the
// drawer on seed.py's own fixture task folder, per-test viewport, and reads
// its real rendered `boundingBox()` width.

const FIXTURE_CARD = "task-card-docs/tasks/2026-01-01-0000-research-e2e-drawer-fixture";

async function openDrawer(page: import("@playwright/test").Page) {
  await page.goto("/kanban");
  await page.getByTestId(FIXTURE_CARD).click();
  const drawer = page.getByTestId("task-drawer");
  await expect(drawer).toBeVisible();
  return drawer;
}

test("drawer is 3/4 viewport width on a 1280px desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const drawer = await openDrawer(page);

  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  // A few px of tolerance for scrollbar/subpixel rounding, not a wrong rule.
  expect(box!.width).toBeGreaterThan(1280 * 0.75 - 4);
  expect(box!.width).toBeLessThan(1280 * 0.75 + 4);
});

test("drawer is full viewport width at the <=900px breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  const drawer = await openDrawer(page);

  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(700 - 4);
  expect(box!.width).toBeLessThan(700 + 4);
});
