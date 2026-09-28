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
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { removeTempDir } from "../helpers/temp-dir.js";
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
  await removeTempDir(tmpDir);
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

// ─── Gates ───────────────────────────────────────────────────────────────────

/**
 * A promise resolved by the first call to `signal`.
 *
 * Every test below used to start a 10 ms interval, sleep for a real 50–100 ms
 * and then assert the injected callback had run. That window is not a property
 * of the seam — it is a bet that the event loop will deliver a tick inside it,
 * and the bet loses whenever the rest of the suite is saturating the machine.
 * Waiting for the call itself cannot be reordered by load: a slow machine only
 * makes the wait longer, and a seam that never fires trips vitest's own
 * timeout, which reports "never called" rather than an assertion about a
 * callback that simply had not happened yet.
 */
function callGate(): { signal: () => void; called: Promise<void> } {
  let signal!: () => void;
  const called = new Promise<void>((resolve) => { signal = resolve; });
  return { signal, called };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RegisterSchedulerOptions seam contract", () => {
  it("getAggregator is called when the scheduler interval fires", async () => {
    const gate = callGate();
    const getAggregator = vi.fn(() => {
      gate.signal();
      return makeAggregator();
    });

    const handle = registerUsageScheduler({
      ctx: { rexDir: join(tmpDir, ".rex"), projectDir: tmpDir },
      getAggregator,
      overrideIntervalMs: 10,
    });

    await gate.called;
    clearInterval(handle);

    expect(getAggregator).toHaveBeenCalled();
  });

  it("broadcast is called when orphaned entries are pruned", async () => {
    // The gate is on `broadcast` — the seam this test is named for. It used to
    // sleep 80 ms and then assert only that `collectAllIds` had run, so the
    // broadcast half of the contract was never checked at all.
    const gate = callGate();
    const broadcast = vi.fn(() => gate.signal());

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

    await gate.called;
    clearInterval(handle);

    // broadcast is only called when there are orphaned entries to remove, and
    // collectAllIds is what determines which IDs are still valid.
    expect(collectAllIds).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "hench:usage-cleanup", totalOrphaned: 1 }),
    );
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
    // Gated on the tick, because the claim is about what happens *when the
    // scheduler fires*. Sleeping instead meant a window with no tick in it
    // satisfied the test without the minimal-options path ever running.
    const gate = callGate();
    const options: RegisterSchedulerOptions = {
      ctx: { rexDir: join(tmpDir, ".rex"), projectDir: tmpDir },
      getAggregator: () => {
        gate.signal();
        return makeAggregator();
      },
      overrideIntervalMs: 10,
      // no broadcast, no collectAllIds, no loadPRD
    };

    const handle = registerUsageScheduler(options);
    await gate.called;
    clearInterval(handle);
    // Reaching here means the tick ran and raised no unhandled error.
  });

  it("overrideIntervalMs is respected over config file defaults", async () => {
    // The scheduler interval should be 10ms, not the default 7-day interval.
    // If overrideIntervalMs is ignored, the gate never opens and the test
    // fails on vitest's timeout naming this test.
    const gate = callGate();
    let fired = false;
    const handle = registerUsageScheduler({
      ctx: { rexDir: join(tmpDir, ".rex"), projectDir: tmpDir },
      getAggregator: () => {
        fired = true;
        gate.signal();
        return makeAggregator();
      },
      overrideIntervalMs: 10,
    });

    await gate.called;
    clearInterval(handle);

    expect(fired).toBe(true);
  });
});
