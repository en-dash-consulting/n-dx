/**
 * Unit tests for the Claude budget-based quota adapter.
 *
 * All file I/O is performed against temporary directories created with
 * mkdtemp so tests are hermetic, deterministic, and leave no disk debris.
 *
 * Scenarios covered:
 *   - Normal output: correct percentages from budget + run spend
 *   - Zero spend: returns 100% remaining
 *   - Over-budget spend: clamped to 0%
 *   - Missing .n-dx.json: returns no_budget
 *   - No tokenUsage.weeklyBudget key: returns no_budget
 *   - Budget present but no claude scope: returns no_budget (unless globalDefault)
 *   - Global default fallback budget
 *   - Vendor default fallback budget
 *   - Model-specific budget (highest-priority lookup)
 *   - Multiple run files (only current week counted)
 *   - Per-turn vendor attribution (codex turns excluded)
 *   - Untagged turns attributed to claude
 *   - Malformed run files are skipped (graceful degradation)
 *   - henchDir override option
 *   - now override option (deterministic week boundary)
 *   - checkQuotaRemaining() returns [] when no budget is configured
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  fetchClaudeQuota,
  type FetchClaudeQuotaOptions,
  type ClaudeQuotaResult,
} from "../../../src/quota/claude-quota.js";
import { checkQuotaRemaining } from "../../../src/quota/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A Monday in a well-known ISO week for deterministic tests. */
const WEEK_2025_W15_MONDAY = new Date("2025-04-07T12:00:00Z"); // 2025-W15
const WEEK_2025_W15_FRIDAY = new Date("2025-04-11T08:00:00Z"); // still 2025-W15
const WEEK_2025_W14_SUNDAY = new Date("2025-04-06T23:59:59Z"); // previous week

/** Write a minimal .n-dx.json with the given config. */
async function writeNdxConfig(
  projectDir: string,
  config: Record<string, unknown>,
): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config), "utf-8");
}

/** Write a minimal .n-dx.json with a weekly budget config. */
async function writeWeeklyBudget(
  projectDir: string,
  weeklyBudget: Record<string, unknown>,
): Promise<void> {
  await writeNdxConfig(projectDir, { tokenUsage: { weeklyBudget } });
}

/** Write a run JSON file to the hench runs directory. */
async function writeRunFile(
  runsDir: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await writeFile(join(runsDir, `${id}.json`), JSON.stringify(data), "utf-8");
}

/** Build default options with the temp project dir and injectable clock. */
function makeOpts(
  projectDir: string,
  overrides: Partial<FetchClaudeQuotaOptions> = {},
): FetchClaudeQuotaOptions {
  return {
    projectDir,
    model: "claude-sonnet-4-6",
    now: WEEK_2025_W15_MONDAY,
    ...overrides,
  };
}

// ── Fixture setup ─────────────────────────────────────────────────────────────

let tmpBase: string;
let runsDir: string;

beforeEach(async () => {
  tmpBase = await mkdtemp(join(tmpdir(), "hench-claude-quota-"));
  runsDir = join(tmpBase, ".hench", "runs");
  await mkdir(runsDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

// ── Normal output with expected percentages ───────────────────────────────────

describe("fetchClaudeQuota — normal output", () => {
  it("returns correct percentRemaining based on budget and spend", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });
    // 40 000 tokens used → 60% remaining
    await writeRunFile(runsDir, "run-1", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 20_000, output: 20_000 },
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.vendor).toBe("claude");
    expect(result.quota.model).toBe("claude-sonnet-4-6");
    expect(result.quota.percentRemaining).toBeCloseTo(60, 5);
  });

  it("returns 50% when exactly half the budget is spent", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 200_000 });
    await writeRunFile(runsDir, "run-1", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 50_000, output: 50_000 },
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBeCloseTo(50, 5);
  });

  it("accumulates spend across multiple run files", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });
    // Two runs: 30 000 + 20 000 = 50 000 → 50% remaining
    await writeRunFile(runsDir, "run-1", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 15_000, output: 15_000 },
    });
    await writeRunFile(runsDir, "run-2", {
      startedAt: WEEK_2025_W15_FRIDAY.toISOString(),
      tokenUsage: { input: 10_000, output: 10_000 },
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBeCloseTo(50, 5);
  });

  it("only counts runs from the current ISO week", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });
    // This week: 20 000 tokens
    await writeRunFile(runsDir, "run-this-week", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 10_000, output: 10_000 },
    });
    // Previous week: should not be counted
    await writeRunFile(runsDir, "run-prev-week", {
      startedAt: WEEK_2025_W14_SUNDAY.toISOString(),
      tokenUsage: { input: 40_000, output: 40_000 },
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    // Only 20 000 out of 100 000 = 80% remaining
    expect(result.quota.percentRemaining).toBeCloseTo(80, 5);
  });
});

// ── Zero spend → 100% ─────────────────────────────────────────────────────────

describe("fetchClaudeQuota — zero spend", () => {
  it("returns 100% when no runs exist for the current week", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });
    // No run files written

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBe(100);
  });

  it("returns 100% when the runs directory does not exist", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });
    // runsDir was created in beforeEach — remove it
    await rm(runsDir, { recursive: true });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBe(100);
  });

  it("returns 100% when all runs are from previous weeks", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });
    await writeRunFile(runsDir, "run-old", {
      startedAt: WEEK_2025_W14_SUNDAY.toISOString(),
      tokenUsage: { input: 99_000, output: 99_000 },
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBe(100);
  });
});

// ── Missing config → no_budget ────────────────────────────────────────────────

describe("fetchClaudeQuota — missing config fallback", () => {
  it("returns no_budget when .n-dx.json is absent", () => {
    // No .n-dx.json written
    const result: ClaudeQuotaResult = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("no_budget");
  });

  it("returns no_budget when tokenUsage.weeklyBudget key is absent", async () => {
    await writeNdxConfig(tmpBase, { llm: { vendor: "claude" } });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("no_budget");
  });

  it("returns no_budget when weeklyBudget is an empty object", async () => {
    await writeWeeklyBudget(tmpBase, {});

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("no_budget");
  });

  it("returns no_budget when weeklyBudget has no entry for claude", async () => {
    await writeWeeklyBudget(tmpBase, {
      vendors: { codex: { default: 500_000 } },
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("no_budget");
  });

  it("returns no_budget when .n-dx.json is invalid JSON", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(tmpBase, ".n-dx.json"), "{invalid json}", "utf-8");

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("no_budget");
  });
});

// ── Budget resolution priority ────────────────────────────────────────────────

describe("fetchClaudeQuota — budget resolution", () => {
  it("uses model-specific budget over vendor default over global", async () => {
    await writeWeeklyBudget(tmpBase, {
      globalDefault: 50_000,
      vendors: {
        claude: {
          default: 80_000,
          models: { "claude-sonnet-4-6": 200_000 },
        },
      },
    });
    // 100 000 tokens spent against model budget of 200 000 → 50%
    await writeRunFile(runsDir, "run-1", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 50_000, output: 50_000 },
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase, { model: "claude-sonnet-4-6" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBeCloseTo(50, 5);
  });

  it("falls back to vendor default when model-specific is absent", async () => {
    await writeWeeklyBudget(tmpBase, {
      vendors: { claude: { default: 100_000 } },
    });
    await writeRunFile(runsDir, "run-1", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 25_000, output: 25_000 },
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase, { model: "claude-opus-4" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    // 50 000 of 100 000 → 50%
    expect(result.quota.percentRemaining).toBeCloseTo(50, 5);
  });

  it("falls back to globalDefault when vendor scope is absent", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 40_000 });
    await writeRunFile(runsDir, "run-1", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 10_000, output: 10_000 },
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    // 20 000 of 40 000 → 50%
    expect(result.quota.percentRemaining).toBeCloseTo(50, 5);
  });
});

// ── Over-budget clamping ──────────────────────────────────────────────────────

describe("fetchClaudeQuota — clamping", () => {
  it("clamps percentRemaining to 0 when spend exceeds budget", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 10_000 });
    await writeRunFile(runsDir, "run-1", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 10_000, output: 10_000 }, // 20 000 > 10 000
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBe(0);
  });
});

// ── Per-turn vendor attribution ───────────────────────────────────────────────

describe("fetchClaudeQuota — per-turn vendor attribution", () => {
  it("counts only claude turns when per-turn vendor metadata is present", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });
    await writeRunFile(runsDir, "run-1", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      // 30 000 claude + 20 000 codex → only 30 000 counted
      turnTokenUsage: [
        { input: 10_000, output: 10_000, vendor: "claude" },
        { input: 10_000, output: 10_000, vendor: "codex" },
        { input: 5_000, output: 5_000, vendor: "claude" },
      ],
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    // 30 000 of 100 000 → 70%
    expect(result.quota.percentRemaining).toBeCloseTo(70, 5);
  });

  it("counts untagged turns (no vendor field) as claude", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });
    await writeRunFile(runsDir, "run-1", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      turnTokenUsage: [
        { input: 20_000, output: 20_000 }, // no vendor → attributed to claude
      ],
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    // 40 000 of 100 000 → 60%
    expect(result.quota.percentRemaining).toBeCloseTo(60, 5);
  });
});

// ── Graceful degradation ──────────────────────────────────────────────────────

describe("fetchClaudeQuota — graceful degradation", () => {
  it("skips malformed run files without throwing", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });
    // Write a corrupted run file
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(runsDir, "bad-run.json"), "{not valid json", "utf-8");
    // And a valid run
    await writeRunFile(runsDir, "good-run", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 10_000, output: 10_000 },
    });

    const result = fetchClaudeQuota(makeOpts(tmpBase));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    // Only the good run counts: 20 000 of 100 000 → 80%
    expect(result.quota.percentRemaining).toBeCloseTo(80, 5);
  });

  it("never throws even when the project directory does not exist", () => {
    const result = fetchClaudeQuota({
      projectDir: "/nonexistent/path/that/does/not/exist",
      model: "claude-sonnet-4-6",
      now: WEEK_2025_W15_MONDAY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("no_budget");
  });
});

// ── Injectable overrides ──────────────────────────────────────────────────────

describe("fetchClaudeQuota — injectable overrides", () => {
  it("uses the provided henchDir instead of the default", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });

    // Create a separate hench directory with a run
    const customHenchDir = join(tmpBase, "custom-hench");
    const customRunsDir = join(customHenchDir, "runs");
    await mkdir(customRunsDir, { recursive: true });
    await writeRunFile(customRunsDir, "run-1", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 30_000, output: 30_000 },
    });

    // Default hench dir has no runs
    const result = fetchClaudeQuota(makeOpts(tmpBase, { henchDir: customHenchDir }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    // 60 000 of 100 000 → 40%
    expect(result.quota.percentRemaining).toBeCloseTo(40, 5);
  });

  it("uses the provided now date to determine the current week", async () => {
    await writeWeeklyBudget(tmpBase, { globalDefault: 100_000 });
    // A run in W15
    await writeRunFile(runsDir, "run-w15", {
      startedAt: WEEK_2025_W15_MONDAY.toISOString(),
      tokenUsage: { input: 20_000, output: 20_000 },
    });

    // Query from W14 perspective — W15 run should not be counted
    const result = fetchClaudeQuota(makeOpts(tmpBase, { now: WEEK_2025_W14_SUNDAY }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBe(100);
  });
});

// ── checkQuotaRemaining integration ──────────────────────────────────────────

describe("checkQuotaRemaining — Claude integration", () => {
  it("returns [] when no weekly budget is configured in the project (missing config fallback)", async () => {
    // The current process.cwd() is the project root which has .n-dx.json but
    // no tokenUsage.weeklyBudget, and OPENAI_API_KEY is not set in CI.
    // checkQuotaRemaining must return an empty array (no errors, no crash).
    const result = await checkQuotaRemaining();
    expect(Array.isArray(result)).toBe(true);
    // We cannot assert length === 0 because OPENAI_API_KEY might be set in
    // the test environment.  What we can assert is that the result conforms.
    for (const entry of result) {
      expect(typeof entry.vendor).toBe("string");
      expect(typeof entry.model).toBe("string");
      expect(typeof entry.percentRemaining).toBe("number");
      expect(entry.percentRemaining).toBeGreaterThanOrEqual(0);
      expect(entry.percentRemaining).toBeLessThanOrEqual(100);
    }
  });
});
