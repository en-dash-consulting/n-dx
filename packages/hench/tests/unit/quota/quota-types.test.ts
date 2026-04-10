import { describe, it, expect } from "vitest";
import { checkQuotaRemaining } from "../../../src/quota/index.js";
import type { QuotaRemaining } from "../../../src/quota/index.js";

/**
 * Tests for the QuotaRemaining type contract and the checkQuotaRemaining function.
 *
 * These tests verify:
 * 1. checkQuotaRemaining() returns an array that conforms to the typed interface.
 * 2. The function never throws regardless of environment configuration.
 * 3. The QuotaRemaining shape is structurally valid — confirming that a
 *    conforming object satisfies the interface (compile-time check exercised
 *    at runtime to catch accidental renames or type drift).
 *
 * Note: checkQuotaRemaining() may return a non-empty array when OPENAI_API_KEY
 * is set in the environment or when tokenUsage.weeklyBudget is configured in
 * .n-dx.json.  Tests in this file must not assert array length to remain
 * environment-agnostic.  See claude-quota.test.ts for budget-specific assertions
 * using isolated temporary directories.
 */
describe("quota sub-zone", () => {
  describe("checkQuotaRemaining", () => {
    it("resolves without throwing", async () => {
      await expect(checkQuotaRemaining()).resolves.toBeDefined();
    });

    it("returns an array", async () => {
      const result = await checkQuotaRemaining();
      expect(Array.isArray(result)).toBe(true);
    });

    it("returned entries conform to the QuotaRemaining interface", async () => {
      const result = await checkQuotaRemaining();
      for (const entry of result) {
        expect(typeof entry.vendor).toBe("string");
        expect(typeof entry.model).toBe("string");
        expect(typeof entry.percentRemaining).toBe("number");
        expect(entry.percentRemaining).toBeGreaterThanOrEqual(0);
        expect(entry.percentRemaining).toBeLessThanOrEqual(100);
      }
    });

    it("never throws even when iterated immediately", async () => {
      const result = await checkQuotaRemaining();
      // Simulate a caller iterating the result without a length guard
      const entries: QuotaRemaining[] = [];
      for (const entry of result) {
        entries.push(entry);
      }
      // Length depends on environment — just assert no throw occurred
      expect(Array.isArray(entries)).toBe(true);
    });
  });

  describe("QuotaRemaining interface shape", () => {
    it("accepts a conforming object", () => {
      // TypeScript compile-time check: if the interface fields change the
      // assignment below will fail to compile, surfacing the regression.
      const sample: QuotaRemaining = {
        vendor: "claude",
        model: "claude-opus-4-5",
        percentRemaining: 75,
      };
      expect(sample.vendor).toBe("claude");
      expect(sample.model).toBe("claude-opus-4-5");
      expect(sample.percentRemaining).toBe(75);
    });

    it("supports percentRemaining at boundary values", () => {
      const exhausted: QuotaRemaining = { vendor: "codex", model: "gpt-4o", percentRemaining: 0 };
      const full: QuotaRemaining = { vendor: "codex", model: "gpt-4o", percentRemaining: 100 };
      expect(exhausted.percentRemaining).toBe(0);
      expect(full.percentRemaining).toBe(100);
    });
  });
});
