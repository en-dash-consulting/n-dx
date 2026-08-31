/**
 * Spawn accounting.
 *
 * The defect being fixed is multiplication, not generosity: retry attempts,
 * plan-mode re-spawns, and the outer run tracker were independent allowances,
 * so one task could cold-spawn twelve times. The property worth pinning is
 * that every spawn draws from one countable budget regardless of *why* it
 * happened — a re-spawn path that avoids charging the retry budget must still
 * be counted here, or the multiplication returns.
 */

import { describe, it, expect } from "vitest";
import {
  createSpawnLedger,
  recordSpawn,
  spawnBudgetExhausted,
  describeSpawnBudget,
  DEFAULT_MAX_SPAWNS_PER_TASK,
} from "../../../src/agent/lifecycle/spawn-budget.js";

describe("spawn ledger", () => {
  it("starts empty with the default ceiling", () => {
    const ledger = createSpawnLedger();
    expect(ledger.total).toBe(0);
    expect(ledger.limit).toBe(DEFAULT_MAX_SPAWNS_PER_TASK);
    expect(spawnBudgetExhausted(ledger)).toBe(false);
  });

  it("counts every spawn reason toward the same total", () => {
    const ledger = createSpawnLedger();
    recordSpawn(ledger, "initial");
    recordSpawn(ledger, "retry");
    recordSpawn(ledger, "plan-respawn");
    recordSpawn(ledger, "fork-fallback");

    expect(ledger.total).toBe(4);
    expect(ledger.byReason).toEqual({
      initial: 1,
      retry: 1,
      "plan-respawn": 1,
      "fork-fallback": 1,
    });
  });

  it("counts re-spawns that deliberately skip the retry budget", () => {
    // The fork fallback and plan re-spawns avoid charging the retry budget
    // because nothing was learned about the task. They must still be counted,
    // or a future path can reintroduce unbounded spawning by not asking.
    const ledger = createSpawnLedger(3);
    recordSpawn(ledger, "fork-fallback");
    recordSpawn(ledger, "plan-respawn");
    recordSpawn(ledger, "plan-respawn");

    expect(spawnBudgetExhausted(ledger)).toBe(true);
  });

  it("reports exhaustion at the limit, not past it", () => {
    // Checked before spawning, so the cap refuses to spend rather than
    // reporting that the spending already happened.
    const ledger = createSpawnLedger(2);
    recordSpawn(ledger, "initial");
    expect(spawnBudgetExhausted(ledger)).toBe(false);
    recordSpawn(ledger, "retry");
    expect(spawnBudgetExhausted(ledger)).toBe(true);
  });

  it("honors a configured ceiling", () => {
    const ledger = createSpawnLedger(3);
    expect(ledger.limit).toBe(3);
  });

  it("falls back to the default for a nonsensical ceiling", () => {
    expect(createSpawnLedger(0).limit).toBe(DEFAULT_MAX_SPAWNS_PER_TASK);
    expect(createSpawnLedger(-5).limit).toBe(DEFAULT_MAX_SPAWNS_PER_TASK);
  });

  it("describes the breakdown, since the same total needs different fixes", () => {
    const ledger = createSpawnLedger(8);
    recordSpawn(ledger, "initial");
    recordSpawn(ledger, "plan-respawn");
    recordSpawn(ledger, "plan-respawn");

    const described = describeSpawnBudget(ledger);
    expect(described).toContain("3/8 spawns");
    expect(described).toContain("plan-respawn=2");
    expect(described).toContain("initial=1");
    // Reasons that never happened are not listed.
    expect(described).not.toContain("retry=0");
  });

  it("bounds the worst case that motivated it", () => {
    // Old behaviour: 4 retries x 3 plan re-spawns = 12 cold spawns.
    const ledger = createSpawnLedger();
    for (let i = 0; i < 12; i++) {
      if (spawnBudgetExhausted(ledger)) break;
      recordSpawn(ledger, i === 0 ? "initial" : "retry");
    }
    expect(ledger.total).toBe(DEFAULT_MAX_SPAWNS_PER_TASK);
    expect(ledger.total).toBeLessThan(12);
  });
});
