/**
 * Flow 3 — switch vendor/model in Settings, run three tasks in one
 * iteration run; Claude first, then Codex.
 *
 * Each leg: Settings › Robot Wrangler → pick the vendor card and its cheapest
 * model → Save → the Readiness list reports "Credentials valid" → on /live
 * choose "A set number" = 3 → Start now → wait on /hench-runs for three
 * completed runs. The legs are serial on one fixture; the Codex leg seeds
 * its tasks only when it starts, so the Claude leg cannot pick them up, and
 * skips by name when `codex` is not on PATH or not logged in.
 */

import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { type RunningDashboard, cleanupFixtureProject } from "../e2e-ui/helpers/fixture-project.js";
import { stopManualDashboard } from "./helpers/stop-dashboard.js";
import { trackConsoleErrors } from "../e2e-ui/helpers/console-errors.js";
import {
  createRealVendorProject,
  startRealDashboard,
  commitAll,
  seedTasks,
  moduleTask,
  DEFAULT_MODELS,
  RUN_TIMEOUT_MS,
  KEEP_FIXTURE,
  type RealVendorProject,
  type Vendor,
} from "./helpers/real-vendor-project.js";
import { prdItem, openLiveTask, waitForCompletedRunCount, attachRunArtifacts } from "./helpers/run-watch.js";
import { caption } from "./helpers/caption.js";
import { hasCli, probeCredentials } from "./helpers/preconditions.js";

test.describe.configure({ mode: "serial" });

const VENDOR_LABEL: Record<Vendor, string> = { claude: "Claude", codex: "Codex" };

/**
 * The model the fixture starts on, so the Claude leg is a real change in
 * Settings (to the cheap model) rather than a no-op that leaves Save
 * disabled. The catalog's recommended Claude entry
 * (packages/core/llm-model-catalog.js); no run uses it, because a run only
 * starts once the switch has saved.
 */
const INITIAL_CLAUDE_MODEL = process.env["NDX_E2E_INITIAL_CLAUDE_MODEL"] ?? "claude-sonnet-5-5";

let project: RealVendorProject;
let dashboard: RunningDashboard;
let completedSoFar = 0;

test.beforeAll(async () => {
  test.skip(!hasCli("claude"), "claude CLI not on PATH");
  project = await createRealVendorProject("claude", INITIAL_CLAUDE_MODEL);
  dashboard = await startRealDashboard(project.dir);
});

test.afterAll(async ({}, testInfo) => {
  // beforeAll can create the project and then fail to start its dashboard;
  // the fixture directory must still be removed.
  if (!project) return;
  if (dashboard) {
    try {
      await stopManualDashboard(dashboard);
    } finally {
      await attachRunArtifacts(testInfo, project.dir);
    }
  }
  if (KEEP_FIXTURE) {
    console.log(`[e2e-manual] fixture kept at ${project.dir}`);
  } else {
    await cleanupFixtureProject(project.dir);
  }
});

/** Settings › Robot Wrangler: pick the vendor and model, save, and read the credential check. */
async function switchVendorInSettings(page: Page, vendor: Vendor, model: string): Promise<"ok" | "bad"> {
  await page.goto(`${dashboard.baseUrl}/work`, { waitUntil: "domcontentloaded" });
  await caption(page, `Settings → Robot Wrangler: switch to ${VENDOR_LABEL[vendor]} / ${model}`);
  await page.locator(".bottombar-settings").click();
  const overlay = page.getByRole("dialog", { name: "Settings" });
  await expect(overlay).toBeVisible();
  await overlay.locator(".settings-overlay-item", { hasText: "Robot Wrangler" }).click();

  const card = overlay.locator(`.llm-vendor-card-${vendor}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
  await expect(card).toHaveAttribute("aria-checked", "true");

  // The model selects list catalog ids as option values; pick the one that
  // has ours, else take the vendor's first select and type the id.
  const withOption = overlay.locator("select.llm-select-input").filter({ has: page.locator(`option[value="${model}"]`) });
  if (await withOption.count()) {
    await withOption.first().selectOption(model);
  } else {
    const select = overlay.locator("select.llm-select-input").first();
    await select.selectOption({ label: "Other model id…" });
    await overlay.getByRole("textbox", { name: / — model id$/ }).first().fill(model);
  }

  // Save is disabled when the page already holds this vendor and model; then there is nothing to write.
  const save = overlay.locator("button.settings-frame-save");
  if (await save.isEnabled()) {
    await save.click();
    await expect(overlay.locator(".settings-frame-indicator")).toHaveText("All changes saved", { timeout: 30_000 });
  }
  await expect(overlay.locator(".settings-frame-indicator")).toHaveText("All changes saved");

  const readiness = overlay.getByRole("list", { name: "Readiness" });
  const credentials = readiness.locator("li", { hasText: /Credentials (valid|failed)/ });
  await expect(credentials).toBeVisible({ timeout: 90_000 });
  const state: "ok" | "bad" = (await credentials.textContent())?.includes("Credentials valid") ? "ok" : "bad";
  await caption(page, state === "ok" ? "Credentials valid" : "Credentials failed");
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(overlay).toHaveCount(0);
  commitAll(project.dir, `switch vendor to ${vendor}`);
  return state;
}

async function startThreeTasks(page: Page, firstTaskId: string): Promise<void> {
  await page.goto(`${dashboard.baseUrl}/live`, { waitUntil: "domcontentloaded" });
  await caption(page, "Live: run a set number of tasks (3)");
  await expect(page.locator(".live-idle .live-card-title")).toBeVisible({ timeout: 15_000 });
  await page.locator("select.start-task-mode-select").selectOption({ label: "A set number" });
  await page.locator("input.start-task-iterations").fill("3");
  await page.getByRole("button", { name: /More ways to run/ }).click();
  // In iterations mode the item's accessible name says what it commits to;
  // its visible text is "Start now · 3 tasks", so locate by that.
  const startNow = page.locator('.ready-menu [role="menuitem"]', { hasText: /^Start now/ });
  await expect(startNow).toContainText("3 tasks");
  await startNow.click();
  await openLiveTask(page, firstTaskId);
}

async function runLeg(page: Page, vendor: Vendor, taskIds: string[], testInfo: TestInfo): Promise<void> {
  const tracker = trackConsoleErrors(page);
  const state = await switchVendorInSettings(page, vendor, DEFAULT_MODELS[vendor]);
  test.skip(state === "bad", `${vendor} credentials failed the dashboard's auth check`);

  await startThreeTasks(page, taskIds[0]);
  await caption(page, "Iteration run started — waiting for 3 completed runs");
  const target = completedSoFar + taskIds.length;
  const runs = await waitForCompletedRunCount(dashboard.baseUrl, target, RUN_TIMEOUT_MS * taskIds.length);
  completedSoFar = runs.filter((r) => r.status === "completed").length;

  for (const id of taskIds) expect(prdItem(project.dir, id).status, `task ${id}`).toBe("completed");

  await page.goto(`${dashboard.baseUrl}/hench-runs`, { waitUntil: "domcontentloaded" });
  await caption(page, `${VENDOR_LABEL[vendor]} leg done — ${target} completed runs`);
  await expect(page.locator(".status-badge--completed")).toHaveCount(target, { timeout: 30_000 });

  const uncaught = tracker.errors.filter((e) => e.startsWith("Uncaught:"));
  await testInfo.attach(`console-errors-${vendor}.txt`, { body: tracker.errors.join("\n"), contentType: "text/plain" });
  expect(uncaught).toEqual([]);
}

test("Claude: three tasks in one iteration run", async ({ page }, testInfo) => {
  test.skip(!(await probeCredentials(dashboard.baseUrl)).ok, "claude credentials not usable");
  const ids = seedTasks(project.dir, project.epicId, [
    moduleTask("greet", "greet", "Hello, <name>!"),
    moduleTask("farewell", "farewell", "Goodbye, <name>!"),
    moduleTask("shout", "shout", "<NAME>! (the name upper-cased with an exclamation mark)"),
  ]);
  await runLeg(page, "claude", ids, testInfo);
});

test("Codex: three more tasks in one iteration run", async ({ page }, testInfo) => {
  test.skip(!hasCli("codex"), "codex CLI not on PATH");
  const ids = seedTasks(project.dir, project.epicId, [
    moduleTask("whisper", "whisper", "<name> lower-cased, followed by three dots"),
    moduleTask("mirror", "mirror", "<name> reversed"),
    moduleTask("repeat", "repeat", "<name> twice, separated by a space"),
  ]);
  await runLeg(page, "codex", ids, testInfo);
});
