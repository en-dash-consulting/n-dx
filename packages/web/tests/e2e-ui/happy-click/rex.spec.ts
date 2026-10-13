/**
 * Happy-click: the Rex pages.
 *
 * Up Next, Tasks (the PRD tree and its forms, pickers and dialogs), Add
 * Items, PRD Graph, Validation, Requirements and the Execution Log. Writes
 * are limited to what the spec can observe and that leaves the fixture
 * usable; the LLM-backed Generate button's intended outcome against the
 * dead local vendor is its error alert.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  createFixtureProject,
  cleanupFixtureProject,
  startDashboard,
  stopDashboardAndWait,
  type FixtureProject,
  type RunningDashboard,
} from "../helpers/fixture-project.js";
import { trackConsoleErrors } from "../helpers/console-errors.js";

let fixture: FixtureProject;
let dashboard: RunningDashboard;

test.beforeAll(async () => {
  fixture = await createFixtureProject({ sources: true });
  dashboard = await startDashboard(fixture.dir);
});

test.afterAll(async () => {
  await stopDashboardAndWait(dashboard.proc);
  await cleanupFixtureProject(fixture.dir);
});

async function gotoView(page: Page, path: string): Promise<void> {
  await page.goto(`${dashboard.baseUrl}/${path}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('nav[aria-label="View navigation"]')).toHaveCount(1, { timeout: 10_000 });
}

test("up next: navigation buttons, the epics toggle, the reorganize and restore panels", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "rex-dashboard");

  await page.getByRole("button", { name: "View all tasks in PRD tree" }).click();
  await expect(page).toHaveURL(/\/prd$/);
  await gotoView(page, "rex-dashboard");

  const epics = page.locator("button.rex-dash-epics-toggle");
  if (await epics.count()) {
    const was = await epics.getAttribute("aria-expanded");
    await epics.click();
    await expect(epics).toHaveAttribute("aria-expanded", was === "true" ? "false" : "true");
  }

  await page.getByRole("button", { name: "Browse Tasks" }).click();
  await expect(page).toHaveURL(/\/prd$/);
  await gotoView(page, "rex-dashboard");
  await page.getByRole("button", { name: "Validate PRD" }).click();
  await expect(page).toHaveURL(/\/validation$/);
  await gotoView(page, "rex-dashboard");

  await page.getByRole("button", { name: /^Reorganize/ }).click();
  const reorgClose = page.getByRole("button", { name: "Close" }).first();
  await expect(reorgClose).toBeVisible();
  await reorgClose.click();
  await expect(reorgClose).toHaveCount(0);

  await page.getByRole("button", { name: "Restore Snapshot" }).click();
  const restoreClose = page.getByRole("button", { name: /^(Close|Done|Back)$/ }).first();
  await expect(restoreClose).toBeVisible();
  await restoreClose.click();
  expect(tracker.errors).toEqual([]);
});

test("tasks: search, add form, prune dry run, graph link, row controls and the detail panel", async ({ page }) => {
  test.setTimeout(60_000);
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "prd");
  const tree = page.locator(".prd-tree-container");
  await expect(tree.getByText("E2E Fixture Epic")).toBeVisible({ timeout: 10_000 });

  // Search narrows and clears.
  const search = page.locator("input.prd-search-input"); // type=search, so a searchbox, not a textbox
  await search.fill("Fixture Task");
  await expect(tree.getByText("E2E Fixture Task")).toBeVisible(); // a match is revealed under its collapsed epic
  await page.getByRole("button", { name: "Clear search and facets" }).click();
  await expect(search).toHaveValue("");
  await expect(tree.getByText("E2E Fixture Epic")).toBeVisible();

  // Add form opens, level buttons toggle, cancel closes without writing.
  await page.getByRole("button", { name: "Add a new item to the PRD" }).click();
  await expect(page.locator("#add-form-title")).toBeVisible();
  for (const level of ["Epic", "Feature", "Task"]) {
    const btn = page.locator(".rex-add-form-level-btn", { hasText: new RegExp(`^${level}$`) });
    await btn.click();
    await expect(btn).toHaveClass(/active|selected/);
  }
  await page.locator(".rex-add-form-btn-cancel").click();
  await expect(page.locator("#add-form-title")).toBeHidden();

  // Prune: open, dry run, cancel — nothing is pruned.
  await page.getByRole("button", { name: "Remove completed subtrees" }).click();
  const prune = page.locator(".prune-confirmation");
  await expect(prune).toBeVisible();
  const dryRun = prune.getByRole("button", { name: /Dry Run/ });
  if (await dryRun.count()) {
    await dryRun.click();
    await expect(prune.getByRole("button", { name: /Cancel prune|Adjust Criteria|Review/ }).first()).toBeVisible({ timeout: 10_000 });
  }
  // The dialog animates while a preview is loading, which never counts as "stable"; force skips that check.
  await page.getByRole("button", { name: "Cancel prune" }).click({ force: true });
  await expect(prune).toHaveCount(0);
  await expect(tree.getByText("E2E Fixture Epic")).toBeVisible();

  // Graph link.
  await page.getByRole("button", { name: "Open PRD graph" }).click();
  await expect(page).toHaveURL(/\/merge-graph$/);
  await gotoView(page, "prd");

  // Row controls: expand the epic, open the status picker, open and cancel the inline add.
  const epicRow = page.locator(".prd-node-row", { hasText: "E2E Fixture Epic" });
  await epicRow.locator(".prd-chevron").click();
  await expect(tree.getByText("E2E Fixture Task")).toBeVisible();
  const taskRow = page.locator(".prd-node-row", { hasText: "E2E Fixture Task" });
  await taskRow.hover();
  await taskRow.getByRole("button", { name: "Change status of E2E Fixture Task" }).click();
  await expect(page.locator(".prd-status-picker")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".prd-status-picker")).toHaveCount(0);
  await epicRow.hover();
  await epicRow.getByRole("button", { name: "Add child item to E2E Fixture Epic" }).click();
  const inlineTitle = page.getByRole("textbox", { name: /^New .* title$/ });
  await expect(inlineTitle).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(inlineTitle).toHaveCount(0);

  // Detail panel: description editor and criterion form open and cancel.
  await taskRow.click();
  const panel = page.locator(".task-status-selector");
  await expect(panel).toBeVisible();
  const addDescription = page.locator("button.task-add-description-btn");
  if (await addDescription.count()) {
    await addDescription.click();
    await page.locator("button.task-edit-cancel").click();
    await expect(page.locator("button.task-edit-cancel")).toHaveCount(0);
  }
  await page.locator("button.task-criterion-add-btn").click();
  await page.getByRole("button", { name: "Cancel add criterion" }).click();
  await expect(page.locator("button.task-criterion-add-btn")).toBeVisible();
  await page.getByRole("button", { name: "Close detail panel" }).click();
  expect(tracker.errors).toEqual([]);
});

test("add items: tabs switch, example chips fill the prompt, batch rows add and remove", async ({ page }) => {
  test.setTimeout(90_000);
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "analysis");

  const more = page.locator("button.rex-analysis-more");
  if (await more.count()) {
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
  }
  for (const label of ["Batch Import", "Project Scan", "Smart Add"]) {
    const tab = page.locator(".rex-analysis-tab", { hasText: label });
    if (!(await tab.count())) continue;
    await tab.click();
    await expect(tab).toHaveClass(/active/);
  }

  const textarea = page.getByRole("textbox", { name: "Smart add description" });
  const chip = page.locator("button.smart-add-example-chip").first();
  if (await chip.count()) {
    await chip.click();
    await expect(textarea).not.toHaveValue("");
  } else {
    await textarea.fill("Add a login form with validation and tests for it.");
  }
  // The vendor is a dead port: Generate must come back with an alert, not hang.
  await page.getByRole("button", { name: "Generate proposals" }).click();
  await expect(page.locator(".smart-add-error[role=alert]")).toBeVisible({ timeout: 60_000 });

  const batch = page.locator(".rex-analysis-tab", { hasText: "Batch Import" });
  if (await batch.count()) {
    await batch.click();
    await page.locator("button.batch-import-add-text-btn").click();
    const remove = page.getByRole("button", { name: "Remove item" }).first();
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(remove).toHaveCount(0);
  }
  expect(tracker.errors.filter((e) => !/status of [45]\d\d/.test(e))).toEqual([]);
});

test("prd graph: display mode, view chips, filters, zoom and the detail card", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "merge-graph");
  await expect(page.locator("button.mg-nav-btn")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Switch to table view" }).click();
  await page.getByRole("button", { name: "Switch to graph view" }).click();
  const epicsOnly = page.locator("button.mg-chip", { hasText: "Epics only" });
  await epicsOnly.click();
  await expect(epicsOnly).toHaveClass(/active/);
  await page.locator("button.mg-chip", { hasText: "Full tree" }).click();

  await page.locator("button.mg-filter-btn").click();
  await expect(page.locator("button.mg-filter-btn")).toHaveClass(/active/);
  await page.getByLabel("From date").fill("2020-01-01");
  await page.getByLabel("To date").fill("2030-01-01");
  const clear = page.locator("button.mg-clear-btn");
  if (await clear.count()) {
    await clear.click();
    await expect(page.getByLabel("From date")).toHaveValue("");
  }
  for (const name of ["Zoom in", "Zoom out", "Fit"]) {
    const btn = page.getByRole("button", { name, exact: true });
    // The canvas keeps animating under the force layout, so the buttons never read as "stable"; force skips that check.
    if ((await btn.count()) && (await btn.isVisible()) && (await btn.isEnabled())) await btn.click({ force: true });
  }
  const node = page.locator('[role="button"][aria-label^="PRD "]').first();
  if (await node.count()) {
    // An SVG <g> under a force layout: its box keeps moving, so hand the click handler the event directly.
    await node.dispatchEvent("click");
    const close = page.locator("button.mg-detail-close");
    await expect(close).toBeVisible();
    await close.click();
    await expect(close).toHaveCount(0);
  }
  await page.locator("button.mg-nav-btn").click();
  await expect(page).toHaveURL(/\/prd$/);
  expect(tracker.errors).toEqual([]);
});

test("validation: tabs, run validation, preview fixes (dry run), refresh the dependency graph", async ({ page }) => {
  test.setTimeout(60_000);
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "validation");

  const run = page.locator("button.val-run-btn");
  await expect(run).toBeVisible({ timeout: 10_000 });
  await run.click();
  await expect(run).toBeEnabled({ timeout: 30_000 });

  const preview = page.getByRole("button", { name: "Preview fixes" });
  if (await preview.count()) {
    await preview.click();
    await expect(page.locator(".cmd-result-output, .validation-actions [role=alert]").first()).toBeVisible({ timeout: 30_000 });
  }

  const deps = page.locator(".val-tab", { hasText: "Dependencies" });
  await deps.click();
  await expect(deps).toHaveClass(/active/);
  const refresh = page.locator("button.dep-refresh-btn");
  if (await refresh.count()) await refresh.click();
  const validation = page.locator(".val-tab", { hasText: "Validation" });
  await validation.click();
  await expect(validation).toHaveClass(/active/);
  expect(tracker.errors).toEqual([]);
});

test("requirements and the execution log: collapsibles, search, event filter, refresh", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "requirements");
  const toggle = page.locator("button.collapsible-toggle").first();
  if (await toggle.count()) {
    const was = await toggle.getAttribute("aria-expanded");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", was === "true" ? "false" : "true");
  }

  await gotoView(page, "activity");
  const count = page.locator(".filter-result-count");
  await expect(count).toBeVisible({ timeout: 10_000 });
  await page.getByRole("textbox", { name: "Search activity" }).fill("zzz-no-such-event");
  await expect(count).toContainText(/0|no/i);
  await page.getByRole("textbox", { name: "Search activity" }).fill("");
  const select = page.getByRole("combobox", { name: "Filter by event" });
  if ((await select.locator("option").count()) > 1) await select.selectOption({ index: 1 });
  await select.selectOption({ index: 0 });
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(count).toBeVisible();
  expect(tracker.errors).toEqual([]);
});
