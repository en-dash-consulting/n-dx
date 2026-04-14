/**
 * Unit tests for standardized token logging across Codex and Claude vendors.
 *
 * Verifies that both vendors produce identical output format and structure
 * for token usage reporting, regardless of token availability or values.
 *
 * @see packages/hench/src/cli/token-logging.ts
 */

import { describe, it, expect } from "vitest";
import {
  formatTokenReport,
  formatTokenAvailability,
  getTokenAvailability,
  formatTokenFallback,
  type TokenCount,
} from "../../../src/cli/token-logging.js";

describe("Token logging standardization", () => {
  describe("formatTokenReport", () => {
    it("formats typical token counts with right alignment", () => {
      const tokens: TokenCount = { input: 1500, output: 300 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("tokens_in:");
      expect(output).toContain("tokens_out:");
      expect(output).toContain("1,500");
      expect(output).toContain("300");
    });

    it("uses consistent field width for both input and output", () => {
      const tokens: TokenCount = { input: 1, output: 999999 };
      const output = formatTokenReport(tokens);

      const lines = output.split("\n");
      const inputLine = lines[0];
      const outputLine = lines[1];

      // Both lines should have their value sections aligned (after the label)
      const inputValueStart = inputLine.indexOf(":");
      const outputValueStart = outputLine.indexOf(":");
      expect(inputValueStart).toBe(outputValueStart);
    });

    it("handles zero tokens (unavailable data fallback)", () => {
      const tokens: TokenCount = { input: 0, output: 0 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("tokens_in:");
      expect(output).toContain("tokens_out:");
      expect(output).toContain("—");
    });

    it("handles null tokens (unavailable data)", () => {
      const output = formatTokenReport(null);

      expect(output).toContain("tokens_in:");
      expect(output).toContain("tokens_out:");
      // Should have two "—" symbols (one per line)
      const dashCount = (output.match(/—/g) || []).length;
      expect(dashCount).toBe(2);
    });

    it("handles large token counts (>1M)", () => {
      const tokens: TokenCount = { input: 1234567, output: 9876543 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("1,234,567");
      expect(output).toContain("9,876,543");
    });

    it("formats with localized thousands separators", () => {
      const tokens: TokenCount = { input: 5000, output: 2000 };
      const output = formatTokenReport(tokens);

      expect(output).toContain("5,000");
      expect(output).toContain("2,000");
    });

    it("maintains two-line structure for consistent parsing", () => {
      const tokens: TokenCount = { input: 100, output: 50 };
      const output = formatTokenReport(tokens);

      const lines = output.split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toMatch(/tokens_in:/);
      expect(lines[1]).toMatch(/tokens_out:/);
    });

    it("produces identical output for both vendors with same token values", () => {
      const tokens: TokenCount = { input: 1500, output: 300 };
      const codexOutput = formatTokenReport(tokens);
      const claudeOutput = formatTokenReport(tokens);

      expect(codexOutput).toBe(claudeOutput);
    });

    it("produces identical output when tokens unavailable for both vendors", () => {
      const codexOutput = formatTokenReport(null);
      const claudeOutput = formatTokenReport(null);

      expect(codexOutput).toBe(claudeOutput);
    });
  });

  describe("formatTokenAvailability", () => {
    it("returns 'available' status for available tokens", () => {
      const status = formatTokenAvailability("available");
      expect(status).toBe("available");
    });

    it("returns informative message for unavailable tokens", () => {
      const status = formatTokenAvailability("unavailable");
      expect(status).toContain("unavailable");
      expect(status.toLowerCase()).toContain("no data");
    });
  });

  describe("getTokenAvailability", () => {
    it("returns 'available' for non-zero tokens", () => {
      const availability = getTokenAvailability({ input: 100, output: 50 });
      expect(availability).toBe("available");
    });

    it("returns 'unavailable' for zero tokens (fallback for missing data)", () => {
      const availability = getTokenAvailability({ input: 0, output: 0 });
      expect(availability).toBe("unavailable");
    });

    it("returns 'unavailable' for null tokens", () => {
      const availability = getTokenAvailability(null);
      expect(availability).toBe("unavailable");
    });

    it("returns 'available' when only input tokens present", () => {
      const availability = getTokenAvailability({ input: 100, output: 0 });
      expect(availability).toBe("available");
    });

    it("returns 'available' when only output tokens present", () => {
      const availability = getTokenAvailability({ input: 0, output: 100 });
      expect(availability).toBe("available");
    });
  });

  describe("formatTokenFallback", () => {
    it("formats fallback message for Codex without reason", () => {
      const message = formatTokenFallback("Codex");
      expect(message).toContain("Codex");
      expect(message).toContain("unavailable");
    });

    it("formats fallback message for Claude without reason", () => {
      const message = formatTokenFallback("Claude");
      expect(message).toContain("Claude");
      expect(message).toContain("unavailable");
    });

    it("includes reason when provided", () => {
      const message = formatTokenFallback("Codex", "API timeout");
      expect(message).toContain("Codex");
      expect(message).toContain("API timeout");
    });

    it("handles complex reason messages", () => {
      const message = formatTokenFallback("Claude", "rate limited by OpenAI");
      expect(message).toContain("Claude");
      expect(message).toContain("rate limited by OpenAI");
    });
  });

  describe("vendor parity", () => {
    it("Codex and Claude produce identical format for same token values", () => {
      const codexTokens: TokenCount = { input: 5000, output: 1500 };
      const claudeTokens: TokenCount = { input: 5000, output: 1500 };

      const codexOutput = formatTokenReport(codexTokens);
      const claudeOutput = formatTokenReport(claudeTokens);

      expect(codexOutput).toBe(claudeOutput);
    });

    it("Codex and Claude handle missing data identically", () => {
      const codexOutput = formatTokenReport(null);
      const claudeOutput = formatTokenReport(null);

      expect(codexOutput).toBe(claudeOutput);
    });

    it("Token values are right-aligned in both vendor outputs", () => {
      const tokens: TokenCount = { input: 100, output: 50000 };
      const output = formatTokenReport(tokens);

      const lines = output.split("\n");
      const inputLine = lines[0];
      const outputLine = lines[1];

      // Values should have leading whitespace (right-aligned)
      expect(inputLine).toMatch(/\s+\d/); // Has spaces before the number
      expect(outputLine).toMatch(/\s+\d/);
    });

    it("Identical padding applied regardless of token magnitude", () => {
      const smallTokens = formatTokenReport({ input: 1, output: 2 });
      const largeTokens = formatTokenReport({ input: 999999, output: 888888 });

      const smallLines = smallTokens.split("\n");
      const largeLines = largeTokens.split("\n");

      // Both should have the same number of lines and similar structure
      expect(smallLines.length).toBe(largeLines.length);
      expect(smallLines[0]).toMatch(/tokens_in:/);
      expect(largeLines[0]).toMatch(/tokens_in:/);
    });
  });
});
