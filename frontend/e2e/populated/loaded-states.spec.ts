import { expect, type Page, test } from "@playwright/test";

// Against the "populated" webServer (fixtures/seed.py): a project with two
// sessions - e2e-session-main (labeled, three calls across three agents,
// a usage-limit event) and e2e-session-other (unlabeled, one call on an
// unpriced model).

const SESSION_MAIN_LABEL = "Add a login page to the app";

function trackErrors(page: Page) {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  return { consoleErrors, pageErrors };
}

test.describe("populated loaded states", () => {
  test("Overview renders seeded rollups and the usage-limit banner, no console errors", async ({ page }) => {
    const { consoleErrors, pageErrors } = trackErrors(page);

    await page.goto("/");

    await expect(page.getByTestId("overview-empty")).toHaveCount(0);
    await expect(page.getByTestId("overview-disconnected")).toHaveCount(0);
    await expect(page.getByTestId("agent-rollup")).toContainText("builder");
    await expect(page.getByTestId("model-rollup")).toContainText("claude-sonnet-5");
    await expect(page.getByTestId("tool-rollup")).toContainText("Bash");
    await expect(page.getByTestId("activity-heatmap")).toBeVisible();
    await expect(page.getByTestId("usage-limit-banner")).toBeVisible();
    await expect(page.getByTestId("usage-limit-banner")).toContainText("e2e-session-main");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("Sessions List renders both seeded sessions, no console errors", async ({ page }) => {
    const { consoleErrors, pageErrors } = trackErrors(page);

    await page.goto("/sessions");

    await expect(page.getByTestId("sessions-table")).toBeVisible();
    await expect(page.getByTestId("session-row-e2e-session-main")).toContainText(SESSION_MAIN_LABEL);
    await expect(page.getByTestId("session-row-e2e-session-other")).toBeVisible();
    // e2e-session-other's one call is on an unpriced model - its cost cell
    // carries the info-dot affordance (goal 3) rather than crashing.
    await expect(page.getByTestId("session-row-e2e-session-other").getByTestId("info-dot")).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("Drilldown renders the seeded session's agents and transcript, no console errors", async ({ page }) => {
    const { consoleErrors, pageErrors } = trackErrors(page);

    await page.goto("/sessions/e2e-session-main");

    await expect(page.getByText(SESSION_MAIN_LABEL)).toBeVisible();
    await expect(page.getByTestId("agent-row-main")).toBeVisible();
    await expect(page.getByTestId("agent-row-builder")).toBeVisible();
    await expect(page.getByTestId("agent-row-reviewer")).toBeVisible();
    await expect(page.getByTestId("chat-thread")).toBeVisible();
    // The one call with a seeded transcript entry (AVAILABLE_REQUEST_ID)
    // renders its Read tool-action line and text response.
    await expect(page.getByTestId("chat-thread")).toContainText("Read — src/login.py");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
