import { describe, it, expect } from "vitest";
import { checkQuotaRemaining } from "../../../src/quota/index.js";
import type { QuotaRemaining } from "../../../src/quota/index.js";

/**
 * Tests for the QuotaRemaining type contract and the checkQuotaRemaining stub.
 *
 * These tests verify:
 * 1. The stub returns an empty array (no-op baseline).
 * 2. The QuotaRemaining shape is structurally valid — confirming that a
 *    conforming object satisfies the interface (compile-time check exercised
 *    at runtime to catch accidental renames or type drift).
 */
describe("quota sub-zone", () => {
  describe("checkQuotaRemaining stub", () => {
    it("returns an empty array", async () => {
      const result = await checkQuotaRemaining();
      expect(result).toEqual([]);
    });

    it("resolves without throwing", async () => {
      await expect(checkQuotaRemaining()).resolves.toBeDefined();
    });

    it("returns an array (never throws when iterated)", async () => {
      const result = await checkQuotaRemaining();
      // Simulate the caller iterating without a length guard
      const entries: QuotaRemaining[] = [];
      for (const entry of result) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(0);
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
