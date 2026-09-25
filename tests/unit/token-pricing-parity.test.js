/**
 * `ndx usage`, `ndx status`, and the dashboard must quote the same cost.
 *
 * Token aggregation exists twice: `packages/rex/src/core/token-usage.ts` backs
 * both CLI surfaces (they share `formatAggregateTokenUsage`, so they agree by
 * construction), and `packages/web/src/server/routes-token-usage.ts` is a
 * standalone aggregation for the dashboard — it carries a `web` bucket for Ask
 * spend that rex's shape does not model.
 *
 * The pricing, however, exists once. This file used to pin only that both
 * surfaces resolved rates from the shared table
 * (`packages/llm-client/src/config.ts` → `MODEL_COSTS`); when pricing became
 * per-model that stopped being enough — two copies of the *arithmetic* (bucket
 * loop, labelled fallback for unknown ids, clamped unattributed residual) can
 * drift just as silently as two copies of a rate table did. So the arithmetic
 * lives in rex (`estimateCostFromTotals`) and the dashboard imports it through
 * its rex gateway rather than keeping a loop of its own.
 *
 * This reads source rather than importing because what it guards is the
 * *absence* of a local copy — a property of the text, not of any value the
 * modules export. The value-level parity (same fixture, same dollar figure to
 * the cent) is pinned by
 * `packages/web/tests/unit/server/token-usage-per-model-parity.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const REX_SRC = join(ROOT, "packages/rex/src/core/token-usage.ts");
const WEB_SRC = join(ROOT, "packages/web/src/server/routes-token-usage.ts");
const WEB_GATEWAY = join(ROOT, "packages/web/src/server/rex-gateway.ts");
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

  it("rex holds the one copy of the per-model arithmetic", () => {
    const src = readFileSync(REX_SRC, "utf-8");
    expect(src).toContain("export function estimateCostFromTotals");
    // The arithmetic prices every bucket at its resolved rates, all four kinds.
    expect(src).toContain("resolveModelPricing");
    expect(src).toContain("priceTokens");
    expect(src).toContain("cacheWriteCost");
    expect(src).toContain("cacheReadCost");
    // Rates come from the shared table, not a local literal.
    expect(src).toContain("FALLBACK_MODEL_PRICING");
    expect(src).toContain("@n-dx/llm-client");
  });

  it("the dashboard imports the arithmetic instead of keeping a copy", () => {
    const src = readFileSync(WEB_SRC, "utf-8");
    // It delegates…
    expect(src).toContain("estimateCostFromTotals");
    // …through the gateway, not by importing rex directly…
    expect(src).toContain('from "./rex-gateway.js"');
    expect(readFileSync(WEB_GATEWAY, "utf-8")).toContain("estimateCostFromTotals");
    // …and holds no pricing of its own: no rate lookups, no multiplication.
    expect(src, "web re-grew a local pricing loop").not.toContain("resolveModelPricing");
    expect(src, "web re-grew a local pricing call").not.toContain("priceTokens");
    expect(src, "web re-grew a local fallback rate").not.toContain("FALLBACK_MODEL_PRICING");
  });

  it("both aggregations attribute models under the same rule", () => {
    // The arithmetic being shared is not enough if the two aggregations
    // disagree about which tokens are attributed: a surface that buckets
    // blank/"unknown" ids would price them at the fallback *silently* instead
    // of on the labelled unattributed line.
    for (const [name, file] of COST_SURFACES) {
      const src = readFileSync(file, "utf-8");
      expect(src, `${name} lost the placeholder-model guard`).toMatch(
        /if \(!key \|\| key === "unknown"\) return;/,
      );
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
