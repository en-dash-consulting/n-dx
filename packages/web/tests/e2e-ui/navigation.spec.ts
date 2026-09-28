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
  "home",
  "analyze",
  "plan",
  "work",
  "workspaces",
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

    // The top navigation is the one element every view shares — settings
    // views open as an overlay over it, so check presence, not visibility.
    await expect(page.locator('nav[aria-label="View navigation"]')).toHaveCount(1, { timeout: 10_000 });

    // Give async data fetches a moment to resolve/reject.
    await page.waitForTimeout(500);

    expect(tracker.errors, `console/page errors on /${view}`).toEqual([]);
  });
}

test("a bare URL lands on home; a stage tab and a section link update the active view", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await page.goto(`${dashboard.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".stage-card")).toHaveCount(3, { timeout: 10_000 });
  await expect(page).toHaveURL(/\/home$/);

  // The Plan column goes to the Plan stage and lights its tab.
  await page.locator('.stage-card[data-stage="plan"]').click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.locator(".topnav-tab.active .topnav-tab-label")).toHaveText("Plan");

  // Tasks opens on arrival and shows the PRD's items, not an empty frame \u2014
  // the tree's virtual scroller needs the section's bounded height to render rows.
  const tasks = page.locator('.stage-section[data-view="prd"]');
  await expect(tasks.locator(".stage-section-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(tasks.getByText("E2E Fixture Epic").first()).toBeVisible({ timeout: 10_000 });

  // Its full page shows them too, and keeps the stage lit.
  await tasks.locator(".stage-section-open").click();
  await expect(page).toHaveURL(/\/prd$/);
  await expect(page.locator("main").getByText("E2E Fixture Epic").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".topnav-tab.active .topnav-tab-label")).toHaveText("Plan");

  // The side stage link steps on to Work.
  await page.locator(".stage-link-next").click();
  await expect(page).toHaveURL(/\/work$/);
  expect(tracker.errors).toEqual([]);
});

test("settings open over the page from the cog and close back to it", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await page.goto(`${dashboard.baseUrl}/work`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".bottombar-settings")).toBeVisible({ timeout: 10_000 });

  await page.locator(".bottombar-settings").click();
  await expect(page).toHaveURL(/\/llm-provider$/);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.locator('main .stage-page[data-stage="work"]')).toHaveCount(1); // still mounted underneath

  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
  expect(tracker.errors).toEqual([]);
});

test("the commands sheet lifts over the page and lowers again", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await page.goto(`${dashboard.baseUrl}/analyze`, { waitUntil: "domcontentloaded" });
  const toggle = page.locator(".bottombar-commands");
  await expect(toggle).toBeVisible({ timeout: 10_000 });

  await toggle.click();
  await expect(page.locator("#commands-sheet")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(/\/analyze$/); // UI state, not a route

  await page.getByRole("button", { name: "Close commands" }).click();
  await expect(page.locator("#commands-sheet")).toBeHidden();
  expect(tracker.errors).toEqual([]);
});
