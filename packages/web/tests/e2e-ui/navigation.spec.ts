/**
 * REQUIRED TEST — see TESTING.md § Required Tests.
 *
 * Navigation smoke test — every main dashboard view loads without throwing.
 *
 * Cheap, broad coverage: for each view ID the sidebar can route to, load it
 * directly by URL (the app supports deep-linking every view — see
 * src/viewer/route-state.ts) and assert it renders something recognizable
 * with zero console/page errors. This catches import errors, undefined
 * property access, and broken data-fetch paths across the whole nav
 * surface cheaply, before the deeper per-workflow specs run.
 *
 * Also the contract for the 0.8.0 redirect aliases (src/shared/view-routing.ts):
 * every old path that moved into a stage must still resolve, with the URL
 * bar landing on its new canonical path.
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
import { VIEW_META } from "../../src/viewer/views/view-meta.js";

let fixture: FixtureProject;
let dashboard: RunningDashboard;

// Every ViewId, read from the navigation model rather than hand-kept here —
// `VIEW_META` is `as const satisfies Record<ViewId, ViewMeta>`, so the
// compiler already rejects a missing or misspelt entry there. A hand-kept
// copy of this list previously drifted silently (it omitted `ask`); this one
// cannot.
const VIEWS = Object.keys(VIEW_META);

// Feature-gated views render nothing interesting with their toggle off, so
// the deep-link loop below turns every gate on before it runs.
const GATED_FEATURES = {
  "sourcevision.prMarkdown": true,
  "sourcevision.ask": true,
  "rex.notionSync": true,
  "rex.integrations": true,
};

test.beforeAll(async () => {
  fixture = await createFixtureProject();
  dashboard = await startDashboard(fixture.dir);
  const res = await fetch(`${dashboard.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes: GATED_FEATURES }),
  });
  if (!res.ok) throw new Error(`Failed to enable feature toggles for the deep-link suite: ${res.status}`);
});

test.afterAll(async () => {
  stopDashboard(dashboard.proc);
  await cleanupFixtureProject(fixture.dir);
});

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

// Live's pages live under /live, not /<view-id>, so the loop above reaches them
// only through the bare ids. These are their canonical addresses; /live-task
// has no task to show and reads as the overview.
test("Live pages load at their canonical paths without console/page errors", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  const paths = ["/live", "/live/analyze", `/live/task/${fixture.taskId}`];
  for (const path of paths) {
    const res = await page.goto(`${dashboard.baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    expect(res?.ok(), `HTTP status for ${path}`).toBeTruthy();
    await expect(page.locator('nav[aria-label="Running now"]')).toHaveCount(1, { timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.waitForTimeout(500);
  }
  expect(tracker.errors, "console/page errors on the Live pages").toEqual([]);
});

test("/live-task with no task id shows the Live overview at /live", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await page.goto(`${dashboard.baseUrl}/live-task`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.locator('nav[aria-label="Running now"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator("main")).not.toBeEmpty();
  expect(tracker.errors).toEqual([]);
});

test("settings opened over a task page close back to it", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  const path = `/live/task/${fixture.taskId}`;
  await page.goto(`${dashboard.baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".bottombar-settings")).toBeVisible({ timeout: 10_000 });

  await page.locator(".bottombar-settings").click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
  expect(tracker.errors).toEqual([]);
});

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

// Redirect aliases (src/shared/view-routing.ts): old top-level paths merged
// into a stage in 0.8.0. The full dashboard here has no scope, so both fire.
const ALIASES: Array<[string, string]> = [
  ["overview", "analyze"],
  ["rex-dashboard", "work"],
];

for (const [oldPath, target] of ALIASES) {
  test(`/${oldPath} redirects to /${target}`, async ({ page }) => {
    const tracker = trackConsoleErrors(page);
    const res = await page.goto(`${dashboard.baseUrl}/${oldPath}`, { waitUntil: "domcontentloaded" });
    expect(res?.ok(), `HTTP status for /${oldPath}`).toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`/${target}$`));
    await expect(page.locator('nav[aria-label="View navigation"]')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(tracker.errors, `console/page errors redirecting /${oldPath} -> /${target}`).toEqual([]);
  });
}

// The rex-scope exception (no redirect, because a rex-scoped viewer has no
// Work stage to redirect to) needs a second server bound to that scope —
// scope is a startup flag, not a per-request one — so it is pinned at the
// unit level instead: see tests/unit/shared/view-routing.test.ts.
