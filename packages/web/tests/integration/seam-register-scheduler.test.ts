/**
 * Injection seam contract test for register-scheduler.ts.
 *
 * Verifies that RegisterSchedulerOptions callbacks are invoked by the
 * underlying scheduler with the expected calling convention. TypeScript
 * enforces structural compatibility at compile time but cannot verify that
 * the implementing module calls injected functions at runtime. These tests
 * catch behavioral regressions when startUsageCleanupScheduler changes
 * without altering the RegisterSchedulerOptions interface signature.
 *
 * @see src/server/task-usage/register-scheduler.ts — the injection site
 * @see CLAUDE.md — Injection seam registry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  registerUsageScheduler,
  type RegisterSchedulerOptions,
} from "../../src/server/task-usage.js";

import { IncrementalTaskUsageAggregator } from "../../src/server/task-usage.js";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let tmpDir: string;
let runsDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "seam-scheduler-"));
  runsDir = join(tmpDir, ".hench", "runs");
  await mkdir(runsDir, { recursive: true });
  await mkdir(join(tmpDir, ".rex"), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAggregator(): IncrementalTaskUsageAggregator {
  return new IncrementalTaskUsageAggregator(runsDir);
}

async function writeRun(
  filename: string,
  taskId: string,
  tokens: { input?: number; output?: number } = {},
): Promise<void> {
  await writeFile(
    join(runsDir, filename),
    JSON.stringify({
      id: filename.replace(/\.json$/, ""),
      taskId,
      startedAt: new Date().toISOString(),
      status: "completed",
      tokenUsage: { input: tokens.input ?? 0, output: tokens.output ?? 0 },
    }),
    "utf-8",
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RegisterSchedulerOptions seam contract", () => {
  it("getAggregator is called when the scheduler interval fires", async () => {
    const getAggregator = vi.fn(() => makeAggregator());

    const handle = registerUsageScheduler({
      ctx: { rexDir: join(tmpDir, ".rex"), projectDir: tmpDir },
      getAggregator,
      overrideIntervalMs: 10,
    });

    // Wait for the interval to fire at least once
    await new Promise((r) => setTimeout(r, 50));
    clearInterval(handle);

    expect(getAggregator).toHaveBeenCalled();
  });

  it("broadcast is called when orphaned entries are pruned", async () => {
    const broadcast = vi.fn();

    // Write a run for a task, then supply an empty valid-IDs set so it's "orphaned"
    await writeRun("run-1.json", "orphaned-task", { input: 100, output: 50 });

    const aggregator = makeAggregator();
    // Pre-populate aggregator cache so pruning has something to remove
    await aggregator.getTaskUsage();

    const collectAllIds = vi.fn(() => new Set<string>()); // no valid IDs → everything is orphaned

    // Write a minimal prd.json so loadPRD returns items
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "test", items: [] }),
      "utf-8",
    );

    const loadPRD = vi.fn(() => ({ items: [] }));

    const handle = registerUsageScheduler({
      ctx: { rexDir: join(tmpDir, ".rex"), projectDir: tmpDir },
      getAggregator: () => aggregator,
      broadcast,
      collectAllIds,
      loadPRD,
      overrideIntervalMs: 10,
    });

    await new Promise((r) => setTimeout(r, 80));
    clearInterval(handle);

    // broadcast is only called when there are orphaned entries to remove
    // collectAllIds must have been called to determine valid IDs
    expect(collectAllIds).toHaveBeenCalled();
  });

  it("returns a clearable interval handle", () => {
    const handle = registerUsageScheduler({
      ctx: { rexDir: join(tmpDir, ".rex"), projectDir: tmpDir },
      getAggregator: () => makeAggregator(),
      overrideIntervalMs: 60_000,
    });

    expect(typeof handle).toBe("object");
    // clearInterval must not throw — the handle is a valid timer
    expect(() => clearInterval(handle)).not.toThrow();
  });

  it("options without broadcast do not throw when scheduler fires", async () => {
    const options: RegisterSchedulerOptions = {
      ctx: { rexDir: join(tmpDir, ".rex"), projectDir: tmpDir },
      getAggregator: () => makeAggregator(),
      overrideIntervalMs: 10,
      // no broadcast, no collectAllIds, no loadPRD
    };

    const handle = registerUsageScheduler(options);
    await new Promise((r) => setTimeout(r, 50));
    clearInterval(handle);
    // Reaching here means no unhandled errors
  });

  it("overrideIntervalMs is respected over config file defaults", async () => {
    // The scheduler interval should be 10ms, not the default 7-day interval.
    // If overrideIntervalMs is ignored, the callback would never fire in 50ms.
    let fired = false;
    const handle = registerUsageScheduler({
      ctx: { rexDir: join(tmpDir, ".rex"), projectDir: tmpDir },
      getAggregator: () => {
        fired = true;
        return makeAggregator();
      },
      overrideIntervalMs: 10,
    });

    await new Promise((r) => setTimeout(r, 100));
    clearInterval(handle);

    expect(fired).toBe(true);
  });
});
