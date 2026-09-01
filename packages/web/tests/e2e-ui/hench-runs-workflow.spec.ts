/**
 * Hench Runs workflow — empty-state "Start Working" button.
 *
 * Regression coverage for the "Start Working does nothing" bug: the view
 * had no WebSocket listener, so starting a task from the empty state gave
 * zero feedback until the next 10s poll tick (or forever, if the agent
 * process failed before writing its first run record). The fixture project
 * uses the "local" LLM vendor pointed at a port nothing listens on, so the
 * spawned hench process fails fast and deterministically — exactly the
 * "no run file ever gets written" case the fix needs to surface.
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

test("empty state shows the pending task and a working Start button", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await page.goto(`${dashboard.baseUrl}/hench-runs`, { waitUntil: "domcontentloaded" });

  await expect(page.getByText("No runs yet.")).toBeVisible();
  await expect(page.locator(".hench-empty-next-task").getByText("E2E Fixture Task")).toBeVisible();

  const startButton = page.getByRole("button", { name: "Run this task with the agent" });
  await expect(startButton).toBeVisible();
  await startButton.click();

  // Button shows immediate "Starting…" loading state from the POST itself.
  await expect(page.getByRole("button", { name: /Starting…|Run this task with the agent/ })).toBeVisible();

  // The view must show *some* live feedback within a few seconds — either
  // the run transitioning through starting/running, or (as in this fixture,
  // where the LLM vendor is unreachable) an explicit failure message. What
  // it must never do is sit unchanged forever with zero indication.
  await expect(page.locator(".hench-empty-live-progress")).toBeVisible({ timeout: 8_000 });

  expect(tracker.errors).toEqual([]);
});
