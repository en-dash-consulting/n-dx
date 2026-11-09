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

  // The empty state renders the split Start control: the primary button is
  // the one-click start (with the task's saved settings, saving the project
  // defaults on a task that has none), and the arrow opens the Prepare task
  // modal.
  await expect(page.getByRole("button", { name: "Open the run settings for this task" })).toBeVisible();
  // The click must reach the execute. Feedback alone is not proof: a refusal
  // shown before any start (a settings read that stopped the click) also
  // fills `.start-task-error`, and that is the "does nothing" bug again.
  const executePosted = page.waitForRequest(
    (req) => req.method() === "POST" && new URL(req.url()).pathname.endsWith("/api/hench/execute"),
    { timeout: 8_000 },
  );
  await page.getByRole("button", { name: "Start a run of this task now, with its saved run settings" }).click();
  await executePosted;

  // The view must show *some* live feedback within a few seconds — either
  // the run transitioning through starting/running (a successful start hands
  // the viewer to the Live task page, whose status chip is that feedback), or
  // (as in this fixture, where the LLM vendor is unreachable) the empty
  // state's explicit "Failed to start" block or the button's own refusal.
  // What it must never do is sit unchanged forever with zero indication.
  await expect(page.locator(".hench-empty-live-progress, .live-task-status, .start-task-error").first()).toBeVisible({ timeout: 8_000 });

  expect(tracker.errors).toEqual([]);
});
