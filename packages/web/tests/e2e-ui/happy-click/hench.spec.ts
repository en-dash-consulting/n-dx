/**
 * Happy-click: the Hench and cross-cutting pages.
 *
 * Runs, Audit, Optimization, Adaptive, Token Usage, Workspaces, All Commands
 * and the Prepare-task modal reached from the Work stage. The fixture has
 * no runs, so the Runs page is exercised in its empty state; nothing here
 * starts an agent (that is the existing hench-runs-workflow spec).
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

test("runs: status filters, vendor/model/worktree selects, and the empty-state link", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "hench-runs");
  const filters = page.locator("button.toggle-btn");
  if (await filters.count()) {
    for (const btn of await filters.all()) {
      await btn.click();
      await expect(btn).toHaveClass(/active/);
    }
    await filters.first().click();
  }
  for (const select of await page.locator("select.hench-filter-select").all()) {
    if ((await select.locator("option").count()) > 1) await select.selectOption({ index: 1 });
    await select.selectOption({ index: 0 });
  }
  const addTask = page.locator("button.hench-empty-link-btn");
  if (await addTask.count()) {
    await addTask.click();
    await expect(page).toHaveURL(/\/prd/);
  }
  expect(tracker.errors).toEqual([]);
});

test("audit, optimization and adaptive pages render and their filters/expanders respond", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "hench-audit");
  await expect(page.locator("main")).not.toBeEmpty();
  const retry = page.getByRole("button", { name: "Retry" });
  if (await retry.count()) await retry.click();

  await gotoView(page, "hench-optimization");
  const category = page.locator("select.wf-category-filter");
  if (await category.count()) {
    if ((await category.locator("option").count()) > 1) await category.selectOption({ index: 1 });
    await category.selectOption({ index: 0 });
  }
  const details = page.locator("button.wf-btn-expand").first();
  if (await details.count()) {
    await details.click();
    await expect(details).toHaveText("Less");
    await details.click();
    await expect(details).toHaveText("Details");
  }

  await gotoView(page, "hench-adaptive");
  await expect(page.locator("main")).not.toBeEmpty();
  expect(tracker.errors).toEqual([]);
});

test("token usage: date range, package filter, period toggles and clear", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "token-usage");
  const dates = page.locator("input.filter-input[type=date]");
  await expect(dates.first()).toBeVisible({ timeout: 10_000 });
  await dates.nth(0).fill("2024-01-01");
  await dates.nth(1).fill("2030-01-01");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(dates.nth(0)).toHaveValue("");

  const pkg = page.locator("select.filter-input");
  if (await pkg.count()) {
    if ((await pkg.locator("option").count()) > 1) await pkg.selectOption({ index: 1 });
    await pkg.selectOption({ index: 0 });
  }
  for (const btn of await page.locator("button.toggle-btn").all()) {
    await btn.click();
    await expect(btn).toHaveClass(/active/);
  }
  const showAll = page.getByRole("button", { name: /^Show all/ });
  if (await showAll.count()) await showAll.click();
  expect(tracker.errors).toEqual([]);
});

test("workspaces: the card opens its workspace; the run-mode picker clamps iterations", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "workspaces");
  const open = page.locator("a.workspace-card-open").first();
  await expect(open).toBeVisible({ timeout: 10_000 });

  const mode = page.locator("select.start-task-mode-select").first();
  if (await mode.count()) {
    await mode.selectOption({ label: "A set number" });
    const iterations = page.locator("input.start-task-iterations").first();
    await expect(iterations).toBeVisible();
    await iterations.fill("99");
    await iterations.blur();
    await expect(iterations).toHaveValue("25");
    await iterations.fill("1");
    await iterations.blur();
    await expect(iterations).toHaveValue("2");
    await mode.selectOption({ label: "This task" });

    await page.getByRole("button", { name: /More ways to run/ }).first().click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }

  await open.click();
  await expect(page).toHaveURL(/\/prd/);
  expect(tracker.errors).toEqual([]);
});

test("all commands: every Run button is enabled or explains why it is unavailable", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "command-reference");
  const runs = page.locator("button.cmdref-run");
  await expect(runs.first()).toBeVisible({ timeout: 10_000 });
  for (const btn of await runs.all()) {
    if (await btn.isEnabled()) continue;
    expect(await btn.getAttribute("title")).toMatch(/^Unavailable: /);
  }
  expect(tracker.errors).toEqual([]);
});

test("prepare-task modal: opens from Ready to run, fields edit, preview renders, close returns to Work", async ({ page }) => {
  test.setTimeout(60_000);
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "work");
  const prepare = page.locator("button.ready-primary").first();
  await expect(prepare).toBeVisible({ timeout: 10_000 });
  await prepare.click();
  await expect(page).toHaveURL(/\/work\/prep\//);
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();

  await expect(dialog.locator("#prep-vendor")).toHaveAttribute("readonly", "");
  const maxTurns = dialog.locator("#prep-maxTurns");
  await maxTurns.fill("7");
  await expect(maxTurns).toHaveValue("7");
  // Under a <details>; disabled when the config already allows a dirty tree.
  const advanced = dialog.locator("details", { has: dialog.locator("#prep-allowDirty") });
  if (await advanced.count()) {
    await advanced.locator("summary").click();
    const allowDirty = dialog.locator("#prep-allowDirty");
    if (await allowDirty.isEnabled()) {
      await allowDirty.check();
      await expect(allowDirty).toBeChecked();
    }
  }

  const preview = dialog.locator("button.prep-preview-btn");
  if (await preview.count()) {
    await preview.click();
    await expect(dialog.getByText(/brief|preview/i).first()).toBeVisible({ timeout: 30_000 });
  }

  const reset = dialog.getByRole("button", { name: "Reset to defaults" });
  if (await reset.count()) {
    await reset.click();
    const keep = dialog.getByRole("button", { name: "Keep" });
    await expect(keep).toBeVisible();
    await keep.click();
  }

  await dialog.locator("button.prep-close").click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(tracker.errors).toEqual([]);
});
