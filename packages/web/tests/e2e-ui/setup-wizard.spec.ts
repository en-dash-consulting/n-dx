/**
 * Setup wizard workflow — the "get started" flow on the landing page for a
 * project with zero n-dx integration. Verifies the in-UI init path (no
 * terminal) actually provisions the project and the dashboard comes up
 * afterward, without a server restart.
 */

import { test, expect } from "@playwright/test";
import {
  createUninitializedFixtureProject,
  cleanupFixtureProject,
  startDashboard,
  stopDashboard,
  type RunningDashboard,
} from "./helpers/fixture-project.js";
import { trackConsoleErrors } from "./helpers/console-errors.js";

let projectDir: string;
let dashboard: RunningDashboard;

test.beforeAll(async () => {
  projectDir = await createUninitializedFixtureProject();
  dashboard = await startDashboard(projectDir);
});

test.afterAll(async () => {
  stopDashboard(dashboard.proc);
  await cleanupFixtureProject(projectDir);
});

test("wizard initializes an uninitialized project end-to-end", async ({ page }) => {
  test.setTimeout(60_000);
  const tracker = trackConsoleErrors(page);

  await page.goto(dashboard.baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#setup-wizard")).toBeVisible();

  // "Local" vendor needs no credentials — deterministic, no external auth.
  await page.locator('.wizard-vendor-tab[data-vendor="local"]').click();
  await expect(page.locator('.wizard-vendor-fields[data-for="local"]')).toBeVisible();

  await page.locator("#wizard-submit").click();

  await expect(page.locator("#wizard-progress")).toBeVisible();
  await expect(page.locator("#wizard-success")).toBeVisible({ timeout: 30_000 });

  // The wizard redirects to "/" once init finishes, which now serves the
  // real dashboard instead of the landing page.
  await page.waitForURL(dashboard.baseUrl + "/", { timeout: 10_000 });
  await expect(
    page.locator('nav[aria-label="View navigation"], nav[aria-label="Section navigation"]'),
  ).toBeVisible({ timeout: 10_000 });

  expect(tracker.errors).toEqual([]);
});
