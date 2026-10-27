/**
 * Waiters and artifact capture for the manual suite.
 *
 * Every wait here is a hang guardrail around a real agent run — it asserts
 * the terminal state the UI reaches, never how long it took.
 */

import { execFileSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { REX_BIN, RUN_TIMEOUT_MS, toolDir } from "./real-vendor-project.js";

export interface PrdItem {
  id: string;
  title: string;
  status: string;
  level: string;
}

/** Every item in the PRD, flattened, read through `rex status --format=json`. */
export function readPrdItems(dir: string): PrdItem[] {
  const raw = execFileSync("node", [REX_BIN, "status", "--format=json", dir], { encoding: "utf-8" });
  const doc = JSON.parse(raw) as { items?: unknown[] };
  const out: PrdItem[] = [];
  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      const item = node as PrdItem & { children?: unknown[] };
      out.push({ id: item.id, title: item.title, status: item.status, level: item.level });
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  walk(doc.items ?? []);
  return out;
}

export function prdItem(dir: string, id: string): PrdItem {
  const item = readPrdItems(dir).find((i) => i.id === id);
  if (!item) throw new Error(`PRD item ${id} not found`);
  return item;
}

const TERMINAL = ["completed", "failed", "error", "timeout", "budget_exceeded", "cancelled", "stuck"];

/**
 * On /live/task/<id>: wait for the status chip to reach a terminal state and
 * assert it is `completed`. A failed run fails fast with the chip's text
 * rather than waiting out the whole budget.
 */
export async function waitForLiveTaskCompleted(page: Page, timeoutMs: number = RUN_TIMEOUT_MS): Promise<void> {
  const chip = page.locator(".live-task-status");
  await expect(chip).toBeVisible({ timeout: 30_000 });
  // The chip reads "<status> · <elapsed>" once a run has ended, so match the prefix.
  await expect
    .poll(async () => (await chip.textContent())?.trim().toLowerCase() ?? "", {
      timeout: timeoutMs,
      intervals: [2_000, 5_000],
      message: "waiting for the live task to reach a terminal status",
    })
    .toMatch(new RegExp(`^(${TERMINAL.join("|")})\\b`));
  await expect(chip, "the run should have completed").toHaveClass(/live-task-status-completed/);
  await expect(page.locator("p.live-task-finished")).toContainText("This run finished");
}

export interface RunSummary {
  id: string;
  status: string;
  taskId?: string;
}

export async function listRuns(baseUrl: string): Promise<RunSummary[]> {
  const res = await fetch(`${baseUrl}/api/hench/runs?limit=50&scope=repo`);
  if (!res.ok) return [];
  const body = (await res.json()) as { runs?: RunSummary[] };
  return body.runs ?? [];
}

const ACTIVE = new Set(["running", "in_progress", "starting", "pending"]);
const FAILED = new Set(["failed", "error", "timeout", "budget_exceeded"]);

/**
 * After "Start now": wait for the run to be recorded, then open its Live
 * task page. The Live overview shows a started run inline rather than
 * navigating, and hench picks the task by priority when several are
 * pending, so the run record — not the click — says which task is live.
 * Returns that task id; `expectedTaskId` wins when it is among the runs.
 */
export async function openLiveTask(page: Page, expectedTaskId: string, timeoutMs = 60_000): Promise<string> {
  const baseUrl = new URL(page.url()).origin;
  let taskId = "";
  await expect
    .poll(
      async () => {
        const runs = await listRuns(baseUrl);
        const expected = runs.find((r) => r.taskId === expectedTaskId);
        const latest = expected ?? runs.find((r) => ACTIVE.has(r.status) || r.status === "completed" || FAILED.has(r.status));
        taskId = latest?.taskId ?? "";
        return taskId ? "started" : "no run yet";
      },
      { timeout: timeoutMs, intervals: [1_000, 2_000], message: "waiting for the started run to be recorded" },
    )
    .toBe("started");
  await page.goto(`${baseUrl}/live/task/${taskId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('nav[aria-label="Running now"]')).toHaveCount(1, { timeout: 15_000 });
  return taskId;
}

/**
 * Wait until `n` runs are completed. Gives up early when a run has failed
 * and nothing is still running, so a dead vendor does not burn the budget.
 */
export async function waitForCompletedRunCount(baseUrl: string, n: number, timeoutMs: number): Promise<RunSummary[]> {
  let runs: RunSummary[] = [];
  await expect
    .poll(
      async () => {
        runs = await listRuns(baseUrl);
        const completed = runs.filter((r) => r.status === "completed").length;
        const running = runs.some((r) => ACTIVE.has(r.status));
        const failed = runs.some((r) => FAILED.has(r.status));
        if (completed >= n) return "done";
        if (failed && !running) return `failed: ${runs.map((r) => `${r.id}=${r.status}`).join(", ")}`;
        return `completed ${completed}/${n}`;
      },
      { timeout: timeoutMs, intervals: [5_000, 10_000], message: `waiting for ${n} completed runs` },
    )
    .toBe("done");
  return runs;
}

async function attachDir(testInfo: TestInfo, dir: string, label: string, contentType: string): Promise<void> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    if (!(await stat(path)).isFile()) continue;
    await testInfo.attach(`${label}/${name}`, { path, contentType });
  }
}

/** Copy the hench run records and run logs into the report, next to the video. */
export async function attachRunArtifacts(testInfo: TestInfo, projectDir: string): Promise<void> {
  await attachDir(testInfo, join(toolDir(projectDir, "hench"), "runs"), "hench-runs", "application/json");
  for (const logs of [join(projectDir, ".run-logs"), join(projectDir, ".ndx", "run-logs")]) {
    await attachDir(testInfo, logs, "run-logs", "text/plain");
  }
}
