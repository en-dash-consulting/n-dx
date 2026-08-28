/**
 * `ndx usage` must not drop cache tokens on the floor.
 *
 * Hench run records carry four token fields, but this aggregation read only
 * `input` and `output` — so a run whose cost was almost entirely cache reads
 * (any resumed session, and every `--review` pass by construction) contributed
 * a few hundred tokens to `ndx usage` instead of millions.
 *
 * The dashboard's parallel aggregation in
 * `packages/web/src/server/routes-token-usage.ts` already tracked all four
 * under these names; this brings the CLI's copy back in line with it.
 *
 * Cache tokens are reported but deliberately kept out of `totalInputTokens`:
 * `estimateCost` prices that field at the full input rate, and cache reads bill
 * at a fraction of it. Fusing them would trade a wrong token figure for a wrong
 * money figure.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractHenchTokenUsage,
  extractHenchTokenEvents,
  groupByCommand,
  estimateCost,
} from "../../../src/core/token-usage.js";

/** A run dominated by cache reads — the shape a resumed review pass produces. */
const RESUMED_REVIEW_RUN = {
  startedAt: "2026-08-27T16:00:00.000Z",
  model: "claude-opus-5",
  tokenUsage: {
    input: 319,
    output: 42_733,
    cacheCreationInput: 553_572,
    cacheReadInput: 14_740_617,
  },
};

describe("ndx usage cache accounting", () => {
  let projectDir: string;
  let runsDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-usage-cache-"));
    runsDir = join(projectDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  async function writeRun(name: string, run: unknown): Promise<void> {
    await writeFile(join(runsDir, name), JSON.stringify(run), "utf-8");
  }

  it("carries cache writes and reads out of the run record", async () => {
    await writeRun("run-1.json", RESUMED_REVIEW_RUN);

    const usage = await extractHenchTokenUsage(projectDir);

    expect(usage.inputTokens).toBe(319);
    expect(usage.outputTokens).toBe(42_733);
    expect(usage.cacheCreationTokens).toBe(553_572);
    expect(usage.cacheReadTokens).toBe(14_740_617);
  });

  it("keeps cache tokens out of the input total, so the cost estimate stays honest", async () => {
    await writeRun("run-1.json", RESUMED_REVIEW_RUN);

    const usage = await extractHenchTokenUsage(projectDir);
    const asAggregate = {
      packages: { rex: usage, hench: usage, sv: usage },
      totalInputTokens: usage.inputTokens,
      totalOutputTokens: usage.outputTokens,
      totalCacheCreationTokens: usage.cacheCreationTokens,
      totalCacheReadTokens: usage.cacheReadTokens,
      totalCalls: usage.calls,
    };

    // 319 input at $3/M is a rounding error; 15M cache reads priced as fresh
    // input would be ~$46. The estimate must not silently become the latter.
    expect(estimateCost(asAggregate).totalRaw).toBeLessThan(1);
  });

  it("reports cache tokens on per-run events", async () => {
    await writeRun("run-1.json", RESUMED_REVIEW_RUN);

    const [event] = await extractHenchTokenEvents(projectDir);

    expect(event.cacheCreationTokens).toBe(553_572);
    expect(event.cacheReadTokens).toBe(14_740_617);
  });

  it("reports cache tokens on per-turn events", async () => {
    await writeRun("run-turns.json", {
      ...RESUMED_REVIEW_RUN,
      turnTokenUsage: [
        { input: 100, output: 200, cacheCreationInput: 1_000, cacheReadInput: 50_000 },
        { input: 219, output: 42_533, cacheCreationInput: 552_572, cacheReadInput: 14_690_617 },
      ],
    });

    const events = await extractHenchTokenEvents(projectDir);
    expect(events).toHaveLength(2);
    expect(events[0].cacheReadTokens).toBe(50_000);
    expect(events[1].cacheCreationTokens).toBe(552_572);
  });

  it("sums cache tokens when grouping by command", async () => {
    await writeRun("run-1.json", RESUMED_REVIEW_RUN);
    await writeRun("run-2.json", { ...RESUMED_REVIEW_RUN, startedAt: "2026-08-27T17:00:00.000Z" });

    const grouped = groupByCommand(await extractHenchTokenEvents(projectDir));
    const run = grouped.find((g) => g.command === "run");

    expect(run?.cacheReadTokens).toBe(14_740_617 * 2);
    expect(run?.cacheCreationTokens).toBe(553_572 * 2);
  });

  it("reports zeroes rather than undefined for a vendor that has no cache", async () => {
    // Codex emits no cache fields at all; consumers must still get numbers.
    await writeRun("codex.json", {
      startedAt: "2026-08-27T16:00:00.000Z",
      tokenUsage: { input: 500, output: 200 },
    });

    const usage = await extractHenchTokenUsage(projectDir);
    expect(usage.cacheCreationTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(0);
  });
});
