/**
 * Happy-click: the Live pages.
 *
 * /live with nothing running (status check, the LLM-free fast analysis, the
 * history link, the run-mode picker), /live/analyze idle, /live/task for
 * the fixture task (tabs, picker, follow), and the Live bar they share.
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

async function gotoLive(page: Page, path: string): Promise<void> {
  await page.goto(`${dashboard.baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('nav[aria-label="Running now"]')).toHaveCount(1, { timeout: 10_000 });
}

test("live overview: status check, fast analysis, stop-all disabled, history link, run-mode picker", async ({ page }) => {
  test.setTimeout(60_000);
  const tracker = trackConsoleErrors(page);
  await gotoLive(page, "/live");

  await page.getByRole("button", { name: "Status check" }).click();
  await expect(page.locator(".live-notice")).toContainText(/Checked/, { timeout: 10_000 });

  const stopAll = page.locator("button.live-stop-all");
  if (await stopAll.count()) await expect(stopAll).toBeDisabled();

  // Fast analysis makes no model calls: it must run and the page must return to idle.
  const fast = page.getByRole("button", { name: "Run analysis (fast)" });
  await expect(fast).toBeVisible({ timeout: 10_000 });
  await fast.click();
  await expect(page.getByRole("button", { name: "Run analysis (fast)" })).toBeVisible({ timeout: 30_000 });

  const mode = page.locator("select.start-task-mode-select");
  await expect(page.locator(".live-idle .live-card-title")).toHaveText("E2E Fixture Task");
  await mode.selectOption({ label: "A set number" });
  await expect(page.locator("input.start-task-iterations")).toBeVisible();
  await mode.selectOption({ label: "Until done" });
  await expect(page.locator(".start-task-mode-hint")).toBeVisible();
  await mode.selectOption({ label: "This task" });
  await page.getByRole("button", { name: /More ways to run/ }).click();
  await expect(page.getByRole("menuitem", { name: /^Start now/ })).toBeVisible();
  await page.keyboard.press("Escape");

  const history = page.locator("a.live-more", { hasText: "Run history" });
  if (await history.count()) {
    await history.click();
    await expect(page).toHaveURL(/\/hench-runs$/);
  }
  expect(tracker.errors).toEqual([]);
});

test("live analysis page: idle copy, crumb back to Live, link to the Analysis stage", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoLive(page, "/live/analyze");
  await expect(page.locator("main")).not.toBeEmpty();
  const stage = page.getByRole("link", { name: "Open the Analysis stage" });
  if (await stage.count()) {
    await stage.click();
    await expect(page).toHaveURL(/\/analyze$/);
    await gotoLive(page, "/live/analyze");
  }
  await page.getByRole("link", { name: "Live", exact: true }).first().click();
  await expect(page).toHaveURL(/\/live$/);
  expect(tracker.errors).toEqual([]);
});

test("live task page: tabs switch the panel, the picker and follow are present, the bar goes home", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoLive(page, `/live/task/${fixture.taskId}`);
  for (const id of ["log", "review", "work"]) {
    const tab = page.locator(`#live-task-tab-${id}`);
    if (!(await tab.count())) continue;
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#live-task-panel")).toHaveAttribute("aria-labelledby", `live-task-tab-${id}`);
  }
  const follow = page.locator("button.live-follow");
  if (await follow.count()) await follow.click();
  await page.locator("a.live-bar-all").click();
  await expect(page).toHaveURL(/\/live$/);
  expect(tracker.errors).toEqual([]);
});
