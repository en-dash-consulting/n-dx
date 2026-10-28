/**
 * Flow 2 — SourceVision analysis → add a PRD task → agent completes it.
 *
 * Run the full analysis from the Analysis stage and follow it on
 * /live/analyze, add a task through the Add form on /prd, start it from the
 * Live page and watch it reach `completed`. Real vendor, real spend.
 */

import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type RunningDashboard, cleanupFixtureProject } from "../e2e-ui/helpers/fixture-project.js";
import { stopManualDashboard } from "./helpers/stop-dashboard.js";
import { trackConsoleErrors } from "../e2e-ui/helpers/console-errors.js";
import {
  createRealVendorProject,
  startRealDashboard,
  commitAll,
  headSha,
  moduleTask,
  toolDir,
  KEEP_FIXTURE,
  type RealVendorProject,
} from "./helpers/real-vendor-project.js";
import { readPrdItems, prdItem, openLiveTask, waitForLiveTaskCompleted, attachRunArtifacts } from "./helpers/run-watch.js";
import { caption } from "./helpers/caption.js";
import { hasCli, probeCredentials } from "./helpers/preconditions.js";

const ANALYZE_TIMEOUT_MS = Number(process.env["NDX_E2E_ANALYZE_TIMEOUT_MS"] ?? 10 * 60_000);

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

async function manifestStamp(dir: string): Promise<string> {
  try {
    const raw = await readFile(join(toolDir(dir, "sourcevision"), "manifest.json"), "utf-8");
    const m = JSON.parse(raw) as { generatedAt?: string; lastAnalysis?: { finishedAt?: string } };
    return m.lastAnalysis?.finishedAt ?? m.generatedAt ?? raw.length.toString();
  } catch {
    return "";
  }
}

async function waitForAnalysisToFinish(baseUrl: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await fetch(`${baseUrl}/api/commands/sv-analyze/status`);
        const body = (await res.json()) as { running?: boolean; error?: string | null };
        if (body.error) return `error: ${body.error}`;
        return body.running ? "running" : "idle";
      },
      { timeout: ANALYZE_TIMEOUT_MS, intervals: [2_000, 5_000], message: "waiting for sv analyze to finish" },
    )
    .toBe("idle");
}

async function addTaskThroughForm(page: Page, title: string, description: string): Promise<void> {
  await page.getByRole("button", { name: "Add a new item to the PRD" }).click();
  await expect(page.locator("#add-form-title")).toBeVisible();
  await page.locator(".rex-add-form-level-btn", { hasText: /^Task$/ }).click();
  await page.locator("#add-form-parent").selectOption({ label: "E2E Manual Epic (epic)" });
  await page.locator("#add-form-title").fill(title);
  await page.locator("#add-form-description").fill(description);
  await page.locator(".rex-add-form-btn-submit").click();
  await expect(page.locator("#add-form-title")).toBeHidden();
}

test("full analysis, then a task added through the form, completed by the agent", async ({ page }, testInfo) => {
  const tracker = trackConsoleErrors(page);
  const stampBefore = await manifestStamp(project.dir);
  const baseSha = headSha(project.dir);

  await page.goto(`${dashboard.baseUrl}/analyze`, { waitUntil: "domcontentloaded" });
  await caption(page, "1/5 Run the full SourceVision analysis");
  const full = page.getByRole("button", { name: "Full analysis" }).first();
  await expect(full).toBeEnabled({ timeout: 15_000 });
  await full.click();

  await page.goto(`${dashboard.baseUrl}/live/analyze`, { waitUntil: "domcontentloaded" });
  await caption(page, "2/5 Following the analysis on the Live page");
  await expect(page.locator('nav[aria-label="Running now"]')).toHaveCount(1, { timeout: 10_000 });
  await waitForAnalysisToFinish(dashboard.baseUrl);
  expect(await manifestStamp(project.dir), "the manifest should be rewritten by the analysis").not.toBe(stampBefore);
  commitAll(project.dir, "full analysis output");

  const before = new Set(readPrdItems(project.dir).map((i) => i.id));
  const spec = moduleTask("farewell", "farewell", "Goodbye, <name>!");
  await page.goto(`${dashboard.baseUrl}/prd`, { waitUntil: "domcontentloaded" });
  await caption(page, "3/5 Add a task through the Add form");
  await addTaskThroughForm(page, spec.title, spec.description);
  const created = readPrdItems(project.dir).filter((i) => !before.has(i.id));
  expect(created).toHaveLength(1);
  const task = created[0];
  commitAll(project.dir, "add task through the dashboard");

  await page.goto(`${dashboard.baseUrl}/live`, { waitUntil: "domcontentloaded" });
  await caption(page, "4/5 Start the task with the agent");
  await expect(page.locator(".live-idle .live-card-title")).toHaveText(task.title, { timeout: 15_000 });
  await page.getByRole("button", { name: /More ways to run/ }).click();
  await page.getByRole("menuitem", { name: /^Start now/ }).click();
  const startedTaskId = await openLiveTask(page, task.id);
  expect(startedTaskId).toBe(task.id);

  await caption(page, "5/5 Watching the run until it completes");
  await waitForLiveTaskCompleted(page);
  expect(prdItem(project.dir, task.id).status).toBe("completed");
  expect(headSha(project.dir)).not.toBe(baseSha);

  await page.goto(`${dashboard.baseUrl}/hench-runs`, { waitUntil: "domcontentloaded" });
  await caption(page, "Done — the run is listed as completed");
  await expect(page.locator(".status-badge--completed").first()).toBeVisible({ timeout: 15_000 });

  const uncaught = tracker.errors.filter((e) => e.startsWith("Uncaught:"));
  await testInfo.attach("console-errors.txt", { body: tracker.errors.join("\n"), contentType: "text/plain" });
  expect(uncaught).toEqual([]);
});
