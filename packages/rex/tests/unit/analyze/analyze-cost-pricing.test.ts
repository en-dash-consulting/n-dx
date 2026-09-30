/**
 * An analyze run's recorded cost is a measurement or it is absent.
 *
 * `priceAnalyzeTokenUsage` feeds `costUsd` on the `analyze_token_usage` log
 * entry, and `ndx`'s run summary prints whatever number it finds there as
 * actual spend. Two inputs can be missing without announcing themselves:
 *
 *  - an unpriced model — `resolveModelPricing` answers with fallback rates and
 *    `known: false` rather than throwing, so pricing off its `pricing` field
 *    alone turns a guess into a dollar figure that looks measured;
 *  - absent provider usage — a run can report calls with every token count at
 *    zero, which prices to exactly `0`.
 *
 * The fallback rates are `claude-sonnet-5`'s, which is also a real catalogue
 * entry, so the unknown-model case is asserted against the sonnet figure
 * specifically: a test that only checked "not a number" would pass against a
 * build that had swapped one plausible guess for another.
 *
 * @see packages/core/run-summary.js — `formatCost(null)` renders "not recorded"
 */

import { describe, it, expect } from "vitest";

import { priceAnalyzeTokenUsage } from "../../../src/cli/commands/analyze.js";
import type { AnalyzeTokenUsage } from "../../../src/schema/index.js";

/** A run that really spent tokens. */
const SPENT: AnalyzeTokenUsage = {
  calls: 3,
  inputTokens: 120_000,
  outputTokens: 8_000,
  cacheCreationInputTokens: 4_000,
  cacheReadInputTokens: 60_000,
};

/** A run that made calls but whose provider reported no usage at all. */
const NO_USAGE_REPORTED: AnalyzeTokenUsage = {
  calls: 3,
  inputTokens: 0,
  outputTokens: 0,
};

const KNOWN_MODEL = "claude-sonnet-5";
const UNPRICED_MODEL = "some-model-that-does-not-exist";

describe("priceAnalyzeTokenUsage", () => {
  it("prices a real run at a known model", () => {
    const cost = priceAnalyzeTokenUsage(SPENT, KNOWN_MODEL);

    expect(typeof cost).toBe("number");
    expect(cost).toBeGreaterThan(0);
  });

  it("counts the optional cache buckets", () => {
    const withoutCache: AnalyzeTokenUsage = {
      calls: SPENT.calls,
      inputTokens: SPENT.inputTokens,
      outputTokens: SPENT.outputTokens,
    };

    expect(priceAnalyzeTokenUsage(SPENT, KNOWN_MODEL)).toBeGreaterThan(
      priceAnalyzeTokenUsage(withoutCache, KNOWN_MODEL)!,
    );
  });

  it("leaves the cost unset for a model that is not in the price table", () => {
    expect(priceAnalyzeTokenUsage(SPENT, UNPRICED_MODEL)).toBeUndefined();
  });

  it("does not quietly charge an unpriced model at the fallback rates", () => {
    // The regression: the fallback IS claude-sonnet-5, so the old code produced
    // a figure indistinguishable from a real sonnet run.
    const sonnet = priceAnalyzeTokenUsage(SPENT, KNOWN_MODEL);

    expect(priceAnalyzeTokenUsage(SPENT, UNPRICED_MODEL)).not.toBe(sonnet);
  });

  it("leaves the cost unset when the provider reported no tokens", () => {
    expect(priceAnalyzeTokenUsage(NO_USAGE_REPORTED, KNOWN_MODEL)).toBeUndefined();
  });

  it("drops the key from the log detail rather than writing a zero", () => {
    // How the caller builds the entry. `JSON.stringify` omits an undefined
    // value, so the reader sees an absent cost and prints "not recorded".
    const detail = JSON.parse(
      JSON.stringify({
        ...NO_USAGE_REPORTED,
        vendor: "claude",
        model: KNOWN_MODEL,
        costUsd: priceAnalyzeTokenUsage(NO_USAGE_REPORTED, KNOWN_MODEL),
      }),
    );

    expect(Object.hasOwn(detail, "costUsd")).toBe(false);
    // And the entry still carries what it does know.
    expect(detail.calls).toBe(3);
    expect(detail.model).toBe(KNOWN_MODEL);
  });
});
