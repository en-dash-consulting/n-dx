/**
 * Flow 1 — prompt → task → agent run to completion.
 *
 * Type a description into the PRD smart-add box, let the vendor turn it into
 * a proposal, accept it, start the task from the Live page and watch
 * /live/task/<id> reach `completed`. Real vendor, real spend; the video is
 * the review artifact.
 */

import { test, expect } from "@playwright/test";
import { type RunningDashboard, cleanupFixtureProject } from "../e2e-ui/helpers/fixture-project.js";
import { stopManualDashboard } from "./helpers/stop-dashboard.js";
import { trackConsoleErrors } from "../e2e-ui/helpers/console-errors.js";
import {
  createRealVendorProject,
  startRealDashboard,
  commitAll,
  headSha,
  KEEP_FIXTURE,
  type RealVendorProject,
} from "./helpers/real-vendor-project.js";
import { readPrdItems, prdItem, openLiveTask, waitForLiveTaskCompleted, attachRunArtifacts } from "./helpers/run-watch.js";
import { caption } from "./helpers/caption.js";
import { hasCli, probeCredentials } from "./helpers/preconditions.js";

const PROMPT =
  "Add src/greet.js exporting a function greet(name) that returns the string Hello, <name>! " +
  "and add test/greet.test.js with one passing node:test case for it. Do not touch other files.";

let project: RealVendorProject;
let dashboard: RunningDashboard;

test.beforeAll(async () => {
  test.skip(!hasCli("claude"), "claude CLI not on PATH");
  project = await createRealVendorProject("claude");
  dashboard = await startRealDashboard(project.dir);
  const auth = await probeCredentials(dashboard.baseUrl);
  test.skip(!auth.ok, `claude credentials not usable: ${auth.error ?? auth.output}`);
});

test.afterAll(async ({}, testInfo) => {
  if (!dashboard) return;
  try {
    await stopManualDashboard(dashboard);
  } finally {
    await attachRunArtifacts(testInfo, project.dir);
  }
  if (KEEP_FIXTURE) {
    console.log(`[e2e-manual] fixture kept at ${project.dir}`);
  } else {
    await cleanupFixtureProject(project.dir);
  }
});

test("a typed prompt becomes a task the agent completes", async ({ page }, testInfo) => {
  const tracker = trackConsoleErrors(page);
  const before = new Set(readPrdItems(project.dir).map((i) => i.id));
  const baseSha = headSha(project.dir);

  await page.goto(`${dashboard.baseUrl}/prd`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".prd-tree-container").getByText("E2E Manual Epic")).toBeVisible({ timeout: 10_000 });
  await caption(page, "The PRD starts with one empty epic");

  // The smart-add box is the Add Items page (Plan › Add Items), not the tree.
  await page.goto(`${dashboard.baseUrl}/analysis`, { waitUntil: "domcontentloaded" });
  await caption(page, "1/5 Describe the work in the smart-add box");

  // Scope the proposal under the seeded epic so it arrives as tasks, not new epics.
  const scope = page.locator("select.smart-add-scope-select");
  if (await scope.count()) {
    const epicOption = scope.locator("option", { hasText: "E2E Manual Epic" });
    await expect(epicOption).toHaveCount(1);
    await scope.selectOption((await epicOption.getAttribute("value")) ?? "");
  }
  await page.getByRole("textbox", { name: "Smart add description" }).fill(PROMPT);
  await page.getByRole("button", { name: "Generate proposals" }).click();

  await caption(page, "2/5 Waiting for the vendor's proposal");
  await expect(page.locator(".smart-add-preview")).toBeVisible({ timeout: 4 * 60_000 });
  await caption(page, "3/5 Accept the proposal into the PRD");
  const accept = page.locator("button.smart-add-btn-accept");
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page.locator(".smart-add-preview")).toBeHidden({ timeout: 60_000 });

  const created = readPrdItems(project.dir).filter((i) => !before.has(i.id));
  expect(created.length, "the accepted proposal should add at least one item").toBeGreaterThan(0);
  const task = created.find((i) => i.level === "task" || i.level === "subtask") ?? created[0];
  await testInfo.attach("created-items.json", { body: JSON.stringify(created, null, 2), contentType: "application/json" });
  commitAll(project.dir, "accept smart-add proposal");

  // Start from the Live page's "Start the next task" card, which must be our task.
  await page.goto(`${dashboard.baseUrl}/live`, { waitUntil: "domcontentloaded" });
  await caption(page, "4/5 Start the task with the agent");
  await expect(page.locator(".live-idle .live-card-title")).toHaveText(task.title, { timeout: 15_000 });
  await page.getByRole("button", { name: /More ways to run/ }).click();
  await page.getByRole("menuitem", { name: /^Start now/ }).click();

  // The proposal may hold several tasks; hench starts the highest-priority one.
  const startedTaskId = await openLiveTask(page, task.id);
  expect(created.map((i) => i.id), "the started task should be one the prompt created").toContain(startedTaskId);
  await caption(page, "5/5 Watching the run until it completes");
  await waitForLiveTaskCompleted(page);

  // The PRD, the run list and git all agree.
  expect(prdItem(project.dir, startedTaskId).status).toBe("completed");
  expect(headSha(project.dir)).not.toBe(baseSha);
  await page.goto(`${dashboard.baseUrl}/hench-runs`, { waitUntil: "domcontentloaded" });
  await caption(page, "Done — the run is listed as completed");
  await expect(page.locator(".status-badge--completed").first()).toBeVisible({ timeout: 15_000 });

  const uncaught = tracker.errors.filter((e) => e.startsWith("Uncaught:"));
  await testInfo.attach("console-errors.txt", { body: tracker.errors.join("\n"), contentType: "text/plain" });
  expect(uncaught).toEqual([]);
});
