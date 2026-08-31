/**
 * `ndx usage`, `ndx status`, and the dashboard must quote the same cost.
 *
 * Token aggregation exists twice: `packages/rex/src/core/token-usage.ts` backs
 * both CLI surfaces (they share `formatAggregateTokenUsage`, so they agree by
 * construction), and `packages/web/src/server/routes-token-usage.ts` is a
 * standalone copy for the dashboard. Two copies of a pricing table drift, and
 * when they do the same run set is quoted at two different dollar figures with
 * nothing failing.
 *
 * This pins the constants to each other. It reads source rather than importing,
 * because the web copy is module-private and rex's is not on the package's
 * public API — neither is reachable from a test without widening a surface for
 * the test's benefit.
 *
 * The deeper fix is to have one implementation. Until then this is the guard.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const REX_SRC = join(ROOT, "packages/rex/src/core/token-usage.ts");
const WEB_SRC = join(ROOT, "packages/web/src/server/routes-token-usage.ts");

/**
 * Pull the four per-million rates out of a `DEFAULT_PRICING` literal.
 * Returns an object keyed by rate name so a missing key reads as `undefined`
 * rather than silently comparing two partial objects as equal.
 */
function readPricing(file) {
  const src = readFileSync(file, "utf-8");
  const block = /const DEFAULT_PRICING[^=]*=\s*\{([\s\S]*?)\}/.exec(src);
  if (!block) throw new Error(`No DEFAULT_PRICING literal found in ${file}`);

  const rates = {};
  for (const [, key, value] of block[1].matchAll(/(\w+PerMillion)\s*:\s*([\d.]+)/g)) {
    rates[key] = Number(value);
  }
  return rates;
}

describe("token pricing parity between the CLI and the dashboard", () => {
  it("both surfaces define the same four rates", () => {
    expect(readPricing(WEB_SRC)).toEqual(readPricing(REX_SRC));
  });

  it("both price cache tokens at all", () => {
    for (const [name, file] of [["rex", REX_SRC], ["web", WEB_SRC]]) {
      const rates = readPricing(file);
      expect(rates.cacheWritePerMillion, `${name} does not price cache writes`).toBeGreaterThan(0);
      expect(rates.cacheReadPerMillion, `${name} does not price cache reads`).toBeGreaterThan(0);
    }
  });

  it("prices cache writes above input and cache reads below it", () => {
    // A cache write costs a premium over fresh input and a read a fraction of
    // it. Rates that violate this ordering are a typo, not a price change.
    const rates = readPricing(REX_SRC);
    expect(rates.cacheWritePerMillion).toBeGreaterThan(rates.inputPerMillion);
    expect(rates.cacheReadPerMillion).toBeLessThan(rates.inputPerMillion);
  });

  it("both surfaces sum all four token kinds into the cost", () => {
    // Guards the arithmetic, not just the constants: a correct table is no use
    // if `estimateCost` still adds only two of the four terms.
    for (const [name, file] of [["rex", REX_SRC], ["web", WEB_SRC]]) {
      const src = readFileSync(file, "utf-8");
      const fn = /function estimateCost[\s\S]*?\n\}/.exec(src);
      expect(fn, `${name}: estimateCost not found`).not.toBeNull();
      expect(fn[0], `${name}: estimateCost ignores cache writes`).toContain("cacheWriteCost");
      expect(fn[0], `${name}: estimateCost ignores cache reads`).toContain("cacheReadCost");
      expect(fn[0]).toMatch(/totalRaw\s*=\s*inputCost\s*\+\s*outputCost\s*\+\s*cacheWriteCost\s*\+\s*cacheReadCost/);
    }
  });
});
