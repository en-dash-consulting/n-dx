/**
 * The run summary must not hide cache tokens behind the fresh-input figure.
 *
 * Run 60c3a951 printed `tokens_in: 319` while its stored record held
 * `{input: 319, output: 42733, cacheCreationInput: 553572, cacheReadInput: 14740617}`.
 * True input was ~15.29M; the headline was four orders of magnitude out.
 *
 * That matters most for `--review`, whose reviewer resumes the work session
 * and therefore spends almost everything on cache reads. A summary that shows
 * 319 makes the review pass look free, which is exactly backwards.
 *
 * The fix shows the four fields separately rather than fusing them into one
 * input number: fresh input and re-read context have different costs and
 * different meanings, and a reader deciding whether `--review` is affordable
 * needs to tell them apart.
 *
 * @see packages/hench/src/cli/token-logging.ts
 */

import { describe, it, expect } from "vitest";
import { formatTokenReport } from "../../../src/cli/token-logging.js";
import type { TokenUsage } from "../../../src/schema/index.js";

/** The run whose summary exposed the defect. */
const RUN_60C3A951: TokenUsage = {
  input: 319,
  output: 42_733,
  cacheCreationInput: 553_572,
  cacheReadInput: 14_740_617,
};

/** Pull the number off a `label: value` line. */
function valueOf(output: string, label: string): number {
  const line = output.split("\n").find((l) => l.trim().startsWith(`${label}:`));
  if (!line) throw new Error(`No "${label}" line in:\n${output}`);
  const raw = line.slice(line.indexOf(":") + 1).replace(/[,\s]/g, "");
  return Number(raw);
}

describe("formatTokenReport cache breakdown", () => {
  it("reports cache writes and reads instead of burying them", () => {
    const output = formatTokenReport(RUN_60C3A951);

    expect(valueOf(output, "tokens_in")).toBe(319);
    expect(valueOf(output, "cache_write")).toBe(553_572);
    expect(valueOf(output, "cache_read")).toBe(14_740_617);
    expect(valueOf(output, "tokens_out")).toBe(42_733);
  });

  it("displays a total equal to the sum of all four fields", () => {
    const output = formatTokenReport(RUN_60C3A951);

    const expected =
      RUN_60C3A951.input +
      RUN_60C3A951.output +
      (RUN_60C3A951.cacheCreationInput ?? 0) +
      (RUN_60C3A951.cacheReadInput ?? 0);

    expect(valueOf(output, "total")).toBe(expected);
    // The point of the total: it is nowhere near the fresh-input figure, and
    // a reader must not be able to mistake one for the other.
    expect(valueOf(output, "total")).toBeGreaterThan(valueOf(output, "tokens_in") * 1000);
  });

  it("keeps the two-line shape when there are no cache tokens", () => {
    // Codex reports no cache fields at all; a run that never hit the cache
    // should not grow three lines of zeroes.
    const plain = formatTokenReport({ input: 1_500, output: 300 });
    expect(plain.split("\n")).toHaveLength(2);
    expect(plain).not.toContain("cache_");
    expect(plain).not.toContain("total:");
  });

  it("treats explicit zero cache fields as no cache activity", () => {
    const zeroed = formatTokenReport({
      input: 1_500,
      output: 300,
      cacheCreationInput: 0,
      cacheReadInput: 0,
    });
    expect(zeroed.split("\n")).toHaveLength(2);
  });

  it("shows the breakdown when only one of the two cache fields is used", () => {
    // A first, unresumed run writes the cache without reading it.
    const output = formatTokenReport({
      input: 1_000,
      output: 500,
      cacheCreationInput: 20_000,
      cacheReadInput: 0,
    });
    expect(valueOf(output, "cache_write")).toBe(20_000);
    expect(valueOf(output, "cache_read")).toBe(0);
    expect(valueOf(output, "total")).toBe(21_500);
  });

  it("keeps the value column aligned as magnitudes diverge", () => {
    const lines = formatTokenReport(RUN_60C3A951).split("\n");
    const valueStarts = lines.map((l) => l.length - l.trimEnd().length + l.search(/\S+$/));
    expect(new Set(valueStarts.map((_, i) => lines[i].length)).size).toBe(1);
  });
});
