/**
 * Cache tokens are part of the bill and must be part of the rollup.
 *
 * Run records carry four token fields — input, output, cacheCreationInput,
 * cacheReadInput — but every rollup summed only the first two. Measured on
 * this repo before the fix: `ndx usage` reported 1,212,931 tokens and $18.00
 * across 1,024 runs while a single run record held 22,785,751 cacheReadInput
 * tokens, 99.5% of that run's usage. `hench record` printed the cache-inclusive
 * total, so two surfaces disagreed ~50x on identical data.
 *
 * Cache tokens are billed, not free: a cache write costs ~1.25x the base input
 * rate and a cache read ~0.1x. Dropping them understates spend and, worse,
 * hides the one number the cost work moves — batching and warm-parent forking
 * trade fresh input for cache reads, which is invisible if cache reads are not
 * counted.
 *
 * @see packages/rex/src/core/token-usage.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  extractHenchTokenUsage,
  aggregateTokenUsage,
  estimateCost,
} from "../../../src/core/token-usage.js";
import { formatAggregateTokenUsage } from "../../../src/cli/commands/token-format.js";
import type { AggregateTokenUsage } from "../../../src/core/token-usage.js";

const EMPTY_PKG = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  calls: 0,
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rex-cache-tokens-"));
  mkdirSync(join(dir, ".hench", "runs"), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a hench run record with all four token fields populated. */
function writeRun(name: string, tokenUsage: Record<string, number>): void {
  writeFileSync(
    join(dir, ".hench", "runs", `${name}.json`),
    JSON.stringify({ startedAt: "2026-08-31T12:00:00.000Z", tokenUsage }),
  );
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

describe("extractHenchTokenUsage cache fields", () => {
  it("carries cacheCreationInput and cacheReadInput through, not just input/output", async () => {
    // The exact shape of a record written by `hench record` today.
    writeRun("run-1", {
      input: 116,
      output: 39319,
      cacheCreationInput: 74984,
      cacheReadInput: 22785751,
    });

    const usage = await extractHenchTokenUsage(dir);

    expect(usage.inputTokens).toBe(116);
    expect(usage.outputTokens).toBe(39319);
    expect(usage.cacheCreationTokens).toBe(74984);
    expect(usage.cacheReadTokens).toBe(22785751);
  });

  it("treats absent cache fields as zero rather than NaN", async () => {
    // Older records predate the cache fields entirely.
    writeRun("legacy", { input: 100, output: 200 });

    const usage = await extractHenchTokenUsage(dir);

    expect(usage.cacheCreationTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(0);
    expect(usage.inputTokens).toBe(100);
  });

  it("sums cache tokens across runs", async () => {
    writeRun("a", { input: 1, output: 2, cacheCreationInput: 10, cacheReadInput: 100 });
    writeRun("b", { input: 3, output: 4, cacheCreationInput: 20, cacheReadInput: 200 });

    const usage = await extractHenchTokenUsage(dir);

    expect(usage.cacheCreationTokens).toBe(30);
    expect(usage.cacheReadTokens).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

describe("aggregateTokenUsage cache totals", () => {
  it("rolls cache tokens into the aggregate", async () => {
    writeRun("run-1", {
      input: 116,
      output: 39319,
      cacheCreationInput: 74984,
      cacheReadInput: 22785751,
    });

    const agg = await aggregateTokenUsage([], dir);

    expect(agg.totalCacheCreationTokens).toBe(74984);
    expect(agg.totalCacheReadTokens).toBe(22785751);
    expect(agg.packages.hench.cacheReadTokens).toBe(22785751);
  });
});

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

describe("estimateCost prices cache tokens", () => {
  const oneMillionEach: AggregateTokenUsage = {
    packages: {
      rex: { ...EMPTY_PKG },
      hench: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        calls: 1,
      },
      sv: { ...EMPTY_PKG },
    },
    totalInputTokens: 1_000_000,
    totalOutputTokens: 1_000_000,
    totalCacheCreationTokens: 1_000_000,
    totalCacheReadTokens: 1_000_000,
    totalCalls: 1,
  };

  it("charges cache writes at 1.25x input and cache reads at 0.1x", () => {
    const cost = estimateCost(oneMillionEach);

    // Base rates $3 in / $15 out per 1M.
    expect(cost.inputCost).toBeCloseTo(3, 10);
    expect(cost.outputCost).toBeCloseTo(15, 10);
    expect(cost.cacheWriteCost).toBeCloseTo(3.75, 10); // 1.25 x 3
    expect(cost.cacheReadCost).toBeCloseTo(0.3, 10); // 0.1 x 3
    expect(cost.totalRaw).toBeCloseTo(22.05, 10);
    expect(cost.total).toBe("$22.05");
  });

  it("does not silently drop a cache-dominated bill", () => {
    // The real shape: cache reads dwarf everything else. Priced at 0.1x they
    // still cost more than the fresh input they replaced.
    const cacheHeavy: AggregateTokenUsage = {
      packages: {
        rex: { ...EMPTY_PKG },
        hench: {
          inputTokens: 116,
          outputTokens: 39_319,
          cacheCreationTokens: 74_984,
          cacheReadTokens: 22_785_751,
          calls: 1,
        },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: 116,
      totalOutputTokens: 39_319,
      totalCacheCreationTokens: 74_984,
      totalCacheReadTokens: 22_785_751,
      totalCalls: 1,
    };

    const cost = estimateCost(cacheHeavy);
    const withoutCache = cost.inputCost + cost.outputCost;

    expect(cost.cacheReadCost).toBeGreaterThan(withoutCache);
    expect(cost.totalRaw).toBeGreaterThan(withoutCache);
  });

  it("respects caller-supplied cache rates", () => {
    const cost = estimateCost(oneMillionEach, {
      inputPerMillion: 10,
      outputPerMillion: 50,
      cacheWritePerMillion: 12.5,
      cacheReadPerMillion: 1,
    });

    expect(cost.cacheWriteCost).toBeCloseTo(12.5, 10);
    expect(cost.cacheReadCost).toBeCloseTo(1, 10);
  });
});

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

describe("formatAggregateTokenUsage cache reporting", () => {
  const usage: AggregateTokenUsage = {
    packages: {
      rex: { ...EMPTY_PKG },
      hench: {
        inputTokens: 100,
        outputTokens: 200,
        cacheCreationTokens: 300,
        cacheReadTokens: 400,
        calls: 1,
      },
      sv: { ...EMPTY_PKG },
    },
    totalInputTokens: 100,
    totalOutputTokens: 200,
    totalCacheCreationTokens: 300,
    totalCacheReadTokens: 400,
    totalCalls: 1,
  };

  it("counts cache tokens in the headline total", () => {
    const [headline] = formatAggregateTokenUsage(usage);
    expect(headline).toContain("1,000");
  });

  it("breaks the four kinds out rather than collapsing them", () => {
    const text = formatAggregateTokenUsage(usage).join("\n");

    expect(text).toContain("100 in");
    expect(text).toContain("200 out");
    expect(text).toMatch(/300 cache ?write/i);
    expect(text).toMatch(/400 cache ?read/i);
  });

  it("still reports usage that has no cache tokens at all", () => {
    const noCache: AggregateTokenUsage = {
      ...usage,
      packages: {
        ...usage.packages,
        hench: { ...usage.packages.hench, cacheCreationTokens: 0, cacheReadTokens: 0 },
      },
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
    };

    const [headline] = formatAggregateTokenUsage(noCache);
    expect(headline).toContain("300");
    expect(headline).not.toMatch(/cache/i);
  });
});
