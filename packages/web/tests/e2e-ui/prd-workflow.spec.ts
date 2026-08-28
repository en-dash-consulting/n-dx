/**
 * PRD tree workflow — add epic, add task under it, verify both survive a
 * reload (regression coverage for the "item disappears on reload" bug:
 * routes-rex/items.ts writing through the legacy prd.md path instead of
 * the PRDStore, silently discarded by the folder-tree cache refresh), then
 * delete both and verify the deletion also survives a reload.
 */

import { test, expect, type Page } from "@playwright/test";
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

async function openAddForm(page: Page) {
  await page.getByRole("button", { name: "Add a new item to the PRD" }).click();
  await expect(page.locator("#add-form-title")).toBeVisible();
}

async function selectLevel(page: Page, level: string) {
  // Exact match: "Task" is a text substring of "Subtask", so a substring
  // selector picks up both buttons.
  await page.locator(".rex-add-form-level-btn", { hasText: new RegExp(`^${level}$`) }).click();
}

async function submitAddForm(page: Page, opts: { level: string; title: string }) {
  await selectLevel(page, opts.level);
  await page.locator("#add-form-title").fill(opts.title);
  await page.locator(".rex-add-form-btn-submit").click();
  // Form closes and the new item's title becomes visible in the tree.
  await expect(page.locator("#add-form-title")).toBeHidden();
}

test("add epic and task persist across reload", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await page.goto(`${dashboard.baseUrl}/prd`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("E2E Fixture Epic")).toBeVisible();

  const epicTitle = `E2E New Epic ${Date.now()}`;
  await openAddForm(page);
  await submitAddForm(page, { level: "Epic", title: epicTitle });
  await expect(page.getByText(epicTitle)).toBeVisible();

  // Reload — this is the exact scenario the user reported as broken.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(epicTitle)).toBeVisible({ timeout: 10_000 });

  // Add a task under the fixture epic.
  const taskTitle = `E2E New Task ${Date.now()}`;
  await openAddForm(page);
  await selectLevel(page, "Task");
  await page.locator("#add-form-parent").selectOption({ label: "E2E Fixture Epic (epic)" });
  await page.locator("#add-form-title").fill(taskTitle);
  await page.locator(".rex-add-form-btn-submit").click();
  await expect(page.locator("#add-form-title")).toBeHidden();

  // Scoped to the tree — clicking a row opens a detail panel that also
  // renders the item's raw markdown (including its title), which a
  // page-wide getByText would also match. The parent epic starts/stays
  // collapsed (prd.ts: defaultExpandDepth: 0); expanding it requires
  // clicking exactly the chevron (see tree-event-delegate.ts) — clicking
  // elsewhere on the row selects it (opens the detail panel) instead.
  const tree = page.locator(".prd-tree-container");
  const epicChevron = page.locator(".prd-node-row", { hasText: "E2E Fixture Epic" }).locator(".prd-chevron");
  await epicChevron.click();
  await expect(tree.getByText(taskTitle)).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(epicTitle)).toBeVisible({ timeout: 10_000 });
  await epicChevron.click();
  await expect(tree.getByText(taskTitle)).toBeVisible({ timeout: 10_000 });

  expect(tracker.errors).toEqual([]);
});

test("delete item persists across reload", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await page.goto(`${dashboard.baseUrl}/prd`, { waitUntil: "domcontentloaded" });

  const epicTitle = `E2E Delete-Me Epic ${Date.now()}`;
  await openAddForm(page);
  await submitAddForm(page, { level: "Epic", title: epicTitle });
  await expect(page.getByText(epicTitle)).toBeVisible();

  const row = page.locator(".prd-node-row", { hasText: epicTitle });
  await row.hover();
  await row.getByRole("button", { name: `Delete ${epicTitle}` }).click();

  const confirmDialog = page.getByRole("dialog");
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: /^Delete /i }).click();
  await expect(confirmDialog).toBeHidden();

  // Scope to the tree — a toast ("Deleted...") legitimately still shows
  // the title text briefly, which a page-wide getByText would also match.
  await expect(row).toBeHidden();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".prd-node-row", { hasText: epicTitle })).toBeHidden();

  expect(tracker.errors).toEqual([]);
});
