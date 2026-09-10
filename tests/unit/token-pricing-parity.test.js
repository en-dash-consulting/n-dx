/**
 * `ndx usage`, `ndx status`, and the dashboard must quote the same cost.
 *
 * Token aggregation exists twice: `packages/rex/src/core/token-usage.ts` backs
 * both CLI surfaces (they share `formatAggregateTokenUsage`, so they agree by
 * construction), and `packages/web/src/server/routes-token-usage.ts` is a
 * standalone copy for the dashboard.
 *
 * This used to compare two hand-written `DEFAULT_PRICING` literals against each
 * other. That guarded drift but institutionalised the duplication, and it could
 * only ever pin a single Sonnet-shaped rate — the moment pricing became
 * per-model there was no single literal left to compare. Both surfaces now
 * resolve rates from one foundation-tier table
 * (`packages/llm-client/src/config.ts` → `MODEL_COSTS`, exposed through
 * `model-pricing.ts`), so what needs guarding is that neither reintroduces a
 * local copy.
 *
 * It reads source rather than importing, because the web copy is
 * module-private and rex's is not on the package's public API — neither is
 * reachable from a test without widening a surface for the test's benefit.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const REX_SRC = join(ROOT, "packages/rex/src/core/token-usage.ts");
const WEB_SRC = join(ROOT, "packages/web/src/server/routes-token-usage.ts");
const SHARED_TABLE = join(ROOT, "packages/llm-client/src/config.ts");
const SHARED_PRICING = join(ROOT, "packages/llm-client/src/model-pricing.ts");

const COST_SURFACES = [
  ["rex", REX_SRC],
  ["web", WEB_SRC],
];

/** Per-million rate names, as written in either surface. */
const RATE_NAMES = /(\w+PerMillion)\s*:\s*([\d.]+)/g;

describe("token pricing parity between the CLI and the dashboard", () => {
  it("neither surface defines its own rate literal", () => {
    // A hardcoded rate here is the drift this file exists to prevent. Rates
    // belong in MODEL_COSTS, where one edit updates every surface at once.
    for (const [name, file] of COST_SURFACES) {
      const src = readFileSync(file, "utf-8");
      const hardcoded = [...src.matchAll(RATE_NAMES)].map(([, key]) => key);
      expect(hardcoded, `${name} hardcodes per-million rates`).toEqual([]);
    }
  });

  it("both surfaces take their fallback rates from the shared table", () => {
    for (const [name, file] of COST_SURFACES) {
      const src = readFileSync(file, "utf-8");
      expect(src, `${name} does not import the shared fallback`).toContain(
        "FALLBACK_MODEL_PRICING",
      );
      expect(src, `${name} does not import from @n-dx/llm-client`).toContain(
        "@n-dx/llm-client",
      );
    }
  });

  it("both surfaces price all four token kinds through the shared helper", () => {
    // Guards the arithmetic, not just the constants: a correct table is no use
    // if a surface still adds only two of the four terms.
    for (const [name, file] of COST_SURFACES) {
      const src = readFileSync(file, "utf-8");
      expect(src, `${name} does not use the shared priceTokens`).toContain("priceTokens");
      const fn = /function estimateCost[\s\S]*?\n\}/.exec(src);
      expect(fn, `${name}: estimateCost not found`).not.toBeNull();
      expect(fn[0], `${name}: estimateCost ignores cache writes`).toContain("cacheWriteCost");
      expect(fn[0], `${name}: estimateCost ignores cache reads`).toContain("cacheReadCost");
    }
  });

  it("the shared helper sums all four token kinds", () => {
    const src = readFileSync(SHARED_PRICING, "utf-8");
    expect(src).toMatch(
      /totalRaw:\s*inputCost\s*\+\s*outputCost\s*\+\s*cacheWriteCost\s*\+\s*cacheReadCost/,
    );
  });

  it("the shared table prices cache writes at or above input and reads below it", () => {
    // A write is at worst free of premium and at best a premium; a read is
    // always a fraction. A rate that inverts this is a typo, not a price change.
    const src = readFileSync(SHARED_TABLE, "utf-8");
    const entries = [
      ...src.matchAll(
        /"([\w.\-]+)":\s*\{\s*inputPerMToken:\s*([\d.]+),\s*outputPerMToken:\s*([\d.]+),\s*cacheWritePerMToken:\s*([\d.]+),\s*cacheReadPerMToken:\s*([\d.]+),?\s*\}/g,
      ),
    ];

    expect(entries.length, "no MODEL_COSTS entries parsed").toBeGreaterThan(5);
    for (const [, model, input, , cacheWrite, cacheRead] of entries) {
      expect(Number(cacheWrite), `${model} cache write`).toBeGreaterThanOrEqual(Number(input));
      expect(Number(cacheRead), `${model} cache read`).toBeLessThan(Number(input));
    }
  });
});
