/**
 * Navigation smoke test — every main dashboard view loads without throwing.
 *
 * Cheap, broad coverage: for each view ID the sidebar can route to, load it
 * directly by URL (the app supports deep-linking every view — see
 * src/viewer/route-state.ts) and assert it renders something recognizable
 * with zero console/page errors. This catches import errors, undefined
 * property access, and broken data-fetch paths across the whole nav
 * surface cheaply, before the deeper per-workflow specs run.
 */

import { test, expect } from "@playwright/test";
import {
  createFixtureProject,
  cleanupFixtureProject,
  startDashboard,
  stopDashboard,
  type FixtureProject,
  type RunningDashboard,
} from "./helpers/fixture-project.js";
import { trackConsoleErrors } from "./helpers/console-errors.js";

let fixture: FixtureProject;
let dashboard: RunningDashboard;

test.beforeAll(async () => {
  fixture = await createFixtureProject();
  dashboard = await startDashboard(fixture.dir);
});

test.afterAll(async () => {
  stopDashboard(dashboard.proc);
  await cleanupFixtureProject(fixture.dir);
});

// Every ViewId from src/shared/view-id.ts. If a view is added or renamed
// there, update this list — that mismatch is itself worth catching.
const VIEWS = [
  "overview",
  "graph",
  "iso-map",
  "zones",
  "analysis",
  "files",
  "routes",
  "architecture",
  "problems",
  "suggestions",
  "rex-dashboard",
  "prd",
  "token-usage",
  "validation",
  "requirements",
  "activity",
  "notion-config",
  "integrations",
  "hench-runs",
  "hench-audit",
  "hench-config",
  "hench-templates",
  "hench-optimization",
  "hench-adaptive",
  "feature-toggles",
  "cli-timeouts",
  "commands",
  "command-reference",
  "llm-provider",
  "project-settings",
  "merge-graph",
  "pr-markdown",
];

for (const view of VIEWS) {
  test(`view "${view}" loads without console/page errors`, async ({ page }) => {
    const tracker = trackConsoleErrors(page);
    const res = await page.goto(`${dashboard.baseUrl}/${view}`, { waitUntil: "domcontentloaded" });
    expect(res?.ok(), `HTTP status for /${view}`).toBeTruthy();

    // The app shell (sidebar) is the one element every view shares.
    await expect(page.locator('nav[aria-label="View navigation"], nav[aria-label="Section navigation"]'))
      .toBeVisible({ timeout: 10_000 });

    // Give async data fetches a moment to resolve/reject.
    await page.waitForTimeout(500);

    expect(tracker.errors, `console/page errors on /${view}`).toEqual([]);
  });
}

test("sidebar navigation click updates the active view", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await page.goto(`${dashboard.baseUrl}/overview`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('nav[aria-label="View navigation"], nav[aria-label="Section navigation"]'))
    .toBeVisible();

  // Expand the REX section (if collapsed) and click "Tasks" (id: "prd").
  const rexSectionHeader = page.locator('.nav-section-header[aria-controls="nav-section-REX"]');
  if ((await rexSectionHeader.getAttribute("aria-expanded")) !== "true") {
    await rexSectionHeader.click();
  }
  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  await expect(page).toHaveURL(/\/prd$/);
  expect(tracker.errors).toEqual([]);
});
