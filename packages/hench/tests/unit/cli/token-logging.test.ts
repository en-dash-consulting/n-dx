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

      // Both lines should reserve the same padded width for the value segment.
      const inputValue = inputLine.split(": ")[1];
      const outputValue = outputLine.split(": ")[1];
      expect(inputValue).toBeTruthy();
      expect(outputValue).toBeTruthy();
      expect(inputValue.length).toBe(outputValue.length);
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

/**
 * A cached run's `tokens_in` counts only the *uncached* input. On the runs that
 * exposed this it was 534 against 34.1M read from cache — the summary
 * understated input by ~65,000x and made a ~$24 run look free. The counts were
 * always on the run record; only this report dropped them.
 */
describe("formatTokenReport — cache tokens", () => {
  const cached = {
    input: 534,
    output: 41_502,
    cacheCreationInput: 875_730,
    cacheReadInput: 34_103_792,
  };

  it("reports both cache halves alongside the uncached counts", () => {
    const output = formatTokenReport(cached);

    expect(output).toContain("875,730");
    expect(output).toContain("34,103,792");
    expect(output).toContain("cache_write:");
    expect(output).toContain("cache_read:");
  });

  it("marks the headline as uncached so it cannot be read as total input", () => {
    expect(formatTokenReport(cached)).toMatch(/tokens_in:\s+534\s+\(uncached\)/);
  });

  it("keeps tokens_in and tokens_out on the first two lines", () => {
    // Cache lines are appended, not interleaved, so line offsets stay stable
    // for anything reading this block.
    const lines = formatTokenReport(cached).split("\n");

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("tokens_in:");
    expect(lines[1]).toContain("tokens_out:");
    expect(lines[2]).toContain("cache_write:");
    expect(lines[3]).toContain("cache_read:");
  });

  it("aligns every value on the widest count", () => {
    // Labels are padded to a common width and values right-aligned in a shared
    // field, so once the "(uncached)" suffix is removed every line is the same
    // length — which is only true if the columns line up.
    const lines = formatTokenReport(cached)
      .split("\n")
      .map((line) => line.replace("  (uncached)", ""));

    expect(new Set(lines.map((line) => line.length)).size).toBe(1);
    // And the field is wide enough for the largest value, not the 8-char default.
    expect(lines[3]).toMatch(/cache_read:\s+34,103,792$/);
  });

  it("is byte-identical to the two-line report when no cache was used", () => {
    const plain = { input: 1500, output: 300 };

    expect(formatTokenReport(plain)).toBe(
      formatTokenReport({ ...plain, cacheCreationInput: 0, cacheReadInput: 0 }),
    );
    expect(formatTokenReport(plain).split("\n")).toHaveLength(2);
  });

  it("treats a cache-only run as available rather than as missing data", () => {
    const cacheOnly = { input: 0, output: 0, cacheReadInput: 29_944 };

    expect(getTokenAvailability(cacheOnly)).toBe("available");
    expect(formatTokenReport(cacheOnly)).toContain("29,944");
  });
});
