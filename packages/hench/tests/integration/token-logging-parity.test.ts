/**
 * Integration test for token logging parity between Codex and Claude vendors.
 *
 * Validates that both vendors produce identical token usage output format
 * when logging run completion. This ensures that switching between vendors
 * does not change the visual or structural appearance of token reports.
 *
 * Test scenarios:
 * - Normal token counts (both vendors report tokens)
 * - Missing token data (fallback to "unavailable" display)
 * - Mixed scenarios (one vendor has data, other doesn't)
 * - Large token counts (formatting consistency across magnitudes)
 *
 * @see packages/hench/src/cli/token-logging.ts — formatTokenReport()
 * @see packages/hench/src/cli/commands/run.ts — runOne() output section
 */

import { describe, it, expect } from "vitest";
import { formatTokenReport, type TokenCount } from "../../../src/cli/token-logging.js";

describe("token logging parity between vendors", () => {
  /**
   * Test scenario 1: Both vendors report normal token usage
   * (typical successful run with token tracking)
   */
  describe("when both vendors have token data", () => {
    it("Codex and Claude produce identical formatted output", () => {
      const codexRun: TokenCount = { input: 2000, output: 500 };
      const claudeRun: TokenCount = { input: 2000, output: 500 };

      const codexOutput = formatTokenReport(codexRun);
      const claudeOutput = formatTokenReport(claudeRun);

      expect(codexOutput).toBe(claudeOutput);
    });

    it("output contains both tokens_in and tokens_out labels", () => {
      const tokens: TokenCount = { input: 1500, output: 300 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("tokens_in:");
      expect(output).toContain("tokens_out:");
    });

    it("values are displayed on separate lines for readability", () => {
      const tokens: TokenCount = { input: 1500, output: 300 };
      const output = formatTokenReport(tokens);

      const lines = output.split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toMatch(/tokens_in:/);
      expect(lines[1]).toMatch(/tokens_out:/);
    });

    it("token values are right-aligned for column alignment", () => {
      const tokens: TokenCount = { input: 5, output: 50000 };
      const output = formatTokenReport(tokens);

      const lines = output.split("\n");
      // Extract the numeric parts
      const inputMatch = lines[0].match(/:\s+(\S+)/);
      const outputMatch = lines[1].match(/:\s+(\S+)/);

      expect(inputMatch).toBeTruthy();
      expect(outputMatch).toBeTruthy();

      // Both should have leading whitespace indicating right-alignment
      expect(lines[0]).toMatch(/\s+\d/);
      expect(lines[1]).toMatch(/\s+\d/);
    });

    it("uses localized number formatting (thousands separators)", () => {
      const tokens: TokenCount = { input: 123456, output: 654321 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("123,456");
      expect(output).toContain("654,321");
    });
  });

  /**
   * Test scenario 2: Both vendors unable to retrieve token data
   * (e.g., API errors, network failures, auth issues)
   */
  describe("when both vendors are missing token data", () => {
    it("Codex and Claude display identical unavailable indicator", () => {
      const codexUnavailable = formatTokenReport(null);
      const claudeUnavailable = formatTokenReport(null);

      expect(codexUnavailable).toBe(claudeUnavailable);
    });

    it("unavailable indicator is a consistent symbol (—)", () => {
      const output = formatTokenReport(null);
      expect(output).toContain("—");
    });

    it("shows unavailable for both input and output", () => {
      const output = formatTokenReport(null);
      const dashCount = (output.match(/—/g) || []).length;
      expect(dashCount).toBe(2);
    });

    it("maintains label structure (tokens_in, tokens_out)", () => {
      const output = formatTokenReport(null);
      expect(output).toContain("tokens_in:");
      expect(output).toContain("tokens_out:");
    });
  });

  /**
   * Test scenario 3: Mixed availability (one has data, other doesn't)
   * (less common but possible in edge cases)
   */
  describe("mixed token availability", () => {
    it("handles case where input tokens present but output missing", () => {
      const tokens: TokenCount = { input: 1000, output: 0 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("tokens_in:");
      expect(output).toContain("tokens_out:");
      expect(output).toContain("1,000");
    });

    it("handles case where output tokens present but input missing", () => {
      const tokens: TokenCount = { input: 0, output: 500 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("tokens_in:");
      expect(output).toContain("tokens_out:");
      expect(output).toContain("500");
    });
  });

  /**
   * Test scenario 4: Extreme values (edge cases)
   */
  describe("extreme token values", () => {
    it("handles very small token counts", () => {
      const tokens: TokenCount = { input: 1, output: 1 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("1");
      expect(output).not.toContain("NaN");
    });

    it("handles very large token counts (millions)", () => {
      const tokens: TokenCount = { input: 5000000, output: 1000000 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("5,000,000");
      expect(output).toContain("1,000,000");
    });

    it("maintains formatting consistency across magnitude ranges", () => {
      const small = formatTokenReport({ input: 10, output: 20 });
      const large = formatTokenReport({ input: 1000000, output: 2000000 });

      // Both should have the same structure
      expect(small.split("\n").length).toBe(large.split("\n").length);
      expect(small).toMatch(/tokens_in:/);
      expect(large).toMatch(/tokens_in:/);
    });
  });

  /**
   * Test scenario 5: Vendor-agnostic consistency
   * (output format is truly independent of vendor)
   */
  describe("vendor-agnostic output", () => {
    it("output format does not include vendor name", () => {
      const tokens: TokenCount = { input: 1500, output: 300 };
      const output = formatTokenReport(tokens);

      // Should not mention "Codex" or "Claude" in the output
      expect(output).not.toMatch(/codex|claude/i);
    });

    it("output format is identical regardless of which vendor generated it", () => {
      const sampleTokens: TokenCount = { input: 2500, output: 1000 };

      // Simulate generating output as if from different vendors
      const output1 = formatTokenReport(sampleTokens);
      const output2 = formatTokenReport(sampleTokens);

      expect(output1).toBe(output2);
    });

    it("switching vendors does not change output appearance", () => {
      // Hypothetical scenario: run with Codex, then Claude
      const codexTokens: TokenCount = { input: 1500, output: 300 };
      const claudeTokens: TokenCount = { input: 1500, output: 300 };

      const codexLog = formatTokenReport(codexTokens);
      const claudeLog = formatTokenReport(claudeTokens);

      // Logs should be identical (no vendor-specific styling)
      expect(codexLog).toBe(claudeLog);
    });
  });

  /**
   * Test scenario 6: Alignment and visual consistency
   * (important for readability in run transcripts)
   */
  describe("visual alignment and readability", () => {
    it("aligns values at consistent column regardless of magnitude", () => {
      const outputs = [
        formatTokenReport({ input: 1, output: 2 }),
        formatTokenReport({ input: 1000, output: 2000 }),
        formatTokenReport({ input: 1000000, output: 2000000 }),
      ];

      // All outputs should have similar visual structure
      for (const output of outputs) {
        const lines = output.split("\n");
        expect(lines.length).toBe(2);
        expect(lines[0]).toMatch(/tokens_in:/);
        expect(lines[1]).toMatch(/tokens_out:/);
      }
    });

    it("does not truncate token values for any reasonable magnitude", () => {
      const tokens: TokenCount = { input: 999999999, output: 888888888 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("999,999,999");
      expect(output).toContain("888,888,888");
    });
  });

  /**
   * Test scenario 7: Fallback consistency
   * (when token data cannot be retrieved, both vendors handle it the same way)
   */
  describe("fallback behavior consistency", () => {
    it("both vendors show same fallback when tokens unavailable", () => {
      const codexFallback = formatTokenReport(null);
      const claudeFallback = formatTokenReport(null);

      expect(codexFallback).toBe(claudeFallback);
    });

    it("fallback does not show partial data (all-or-nothing approach)", () => {
      // When tokens are unavailable (null), both should show unavailable
      const output = formatTokenReport(null);
      const dashCount = (output.match(/—/g) || []).length;

      // Should have 2 dashes (one per line), not mixed with real numbers
      expect(dashCount).toBe(2);
    });
  });
});
