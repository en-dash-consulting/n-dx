import { describe, it, expect } from "vitest";
import { parseCodexCliTokenUsage } from "../../../src/agent/lifecycle/codex-cli-token-parser.js";

describe("parseCodexCliTokenUsage", () => {
  describe("standard format", () => {
    it("extracts tokens from 'Tokens used: N in, N out' format", () => {
      const output = "Some output\nTokens used: 1234 in, 567 out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 567 });
    });

    it("handles comma-formatted numbers", () => {
      const output = "Tokens used: 1,234 in, 5,678 out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 5678 });
    });

    it("handles large comma-formatted numbers", () => {
      const output = "Tokens used: 1,234,567 in, 987,654 out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234567, output: 987654 });
    });

    it("handles 'input' and 'output' suffixes", () => {
      const output = "Tokens used: 1234 input, 567 output\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 567 });
    });

    it("handles varying whitespace", () => {
      const output = "Tokens used:  1234  in ,  567  out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 567 });
    });
  });

  describe("absent token line", () => {
    it("returns null when no token line is present", () => {
      const output = "Some CLI output\nNo token info here\nDone.";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseCodexCliTokenUsage("")).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
      expect(parseCodexCliTokenUsage("   \n\n  ")).toBeNull();
    });
  });

  describe("malformed numbers", () => {
    it("returns null when input is non-numeric", () => {
      const output = "Tokens used: abc in, 567 out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toBeNull();
    });

    it("returns null when output is non-numeric", () => {
      const output = "Tokens used: 1234 in, xyz out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toBeNull();
    });

    it("returns null for negative numbers", () => {
      const output = "Tokens used: -1234 in, 567 out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toBeNull();
    });

    it("returns null for float numbers", () => {
      const output = "Tokens used: 12.34 in, 567 out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toBeNull();
    });
  });

  describe("multi-line output variants", () => {
    it("uses last occurrence when multiple token lines exist", () => {
      const output = `
Processing...
Tokens used: 100 in, 50 out
More processing...
Tokens used: 1234 in, 567 out
Done.
      `;
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 567 });
    });

    it("extracts from multi-line output with mixed content", () => {
      const output = `
[Codex] Starting execution...
[Codex] Running tool: shell
[Codex] Command completed successfully
Tokens used: 8542 in, 2130 out
[Codex] Execution complete
      `;
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 8542, output: 2130 });
    });

    it("handles token line in stderr-style output", () => {
      const output = `
Warning: something happened
Error: recovered gracefully
Tokens used: 1234 in, 567 out
      `;
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 567 });
    });

    it("handles Windows-style line endings", () => {
      const output = "Some output\r\nTokens used: 1234 in, 567 out\r\nDone";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 567 });
    });
  });

  describe("partial output", () => {
    it("handles output truncated before token line", () => {
      const output = "Starting...\nProcessing...\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toBeNull();
    });

    it("handles token line as only content", () => {
      const output = "Tokens used: 1234 in, 567 out";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 567 });
    });
  });

  describe("two-line format", () => {
    // Codex CLI may emit token usage split across two lines:
    // the label "tokens used" on one line and the numeric count on the next.
    // These tests define expected behaviour for that format.

    it("extracts token count from nominal two-line 'tokens used\\n<number>' format", () => {
      const output = "tokens used\n1234";
      const result = parseCodexCliTokenUsage(output);
      // Total count stored as input; no input/output split available.
      expect(result).toEqual({ input: 1234, output: 0 });
    });

    it("extracts token count from 'Tokens used:\\n<number>' variant", () => {
      const output = "Tokens used:\n1234";
      const result = parseCodexCliTokenUsage(output);
      expect(result).toEqual({ input: 1234, output: 0 });
    });

    it("handles comma-formatted count in two-line format", () => {
      const output = "tokens used\n1,234";
      const result = parseCodexCliTokenUsage(output);
      expect(result).toEqual({ input: 1234, output: 0 });
    });

    it("handles whitespace-padded count in two-line format", () => {
      const output = "tokens used\n  1,234  ";
      const result = parseCodexCliTokenUsage(output);
      expect(result).toEqual({ input: 1234, output: 0 });
    });

    it("returns null when a blank line separates label from count", () => {
      // A blank line breaks the two-line pattern — safe null rather than silent mis-parse.
      const output = "tokens used\n\n1234";
      const result = parseCodexCliTokenUsage(output);
      expect(result).toBeNull();
    });

    it("two-line format embedded in multi-line output", () => {
      const output =
        "[Codex] Running...\ntokens used\n8542\n[Codex] Done.";
      const result = parseCodexCliTokenUsage(output);
      expect(result).toEqual({ input: 8542, output: 0 });
    });

    it("legacy same-line format is unaffected by two-line support", () => {
      const output = "Tokens used: 1234 in, 567 out";
      const result = parseCodexCliTokenUsage(output);
      expect(result).toEqual({ input: 1234, output: 567 });
    });

    it("returns null when only the label line is present (no following count line)", () => {
      // Confirms no premature token result before the count line arrives —
      // if budget were checked per-line, this ensures it sees null rather than
      // a stale or zero count.
      const output = "tokens used";
      expect(parseCodexCliTokenUsage(output)).toBeNull();
    });

    it("returns null when the line following the label is empty", () => {
      // Empty next line does not satisfy the count pattern.
      const output = "tokens used\n";
      expect(parseCodexCliTokenUsage(output)).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles zero token counts", () => {
      const output = "Tokens used: 0 in, 0 out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 0, output: 0 });
    });

    it("handles very large numbers", () => {
      const output = "Tokens used: 999999999 in, 888888888 out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 999999999, output: 888888888 });
    });

    it("is case insensitive for 'Tokens used'", () => {
      const output = "tokens used: 1234 in, 567 out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 567 });
    });

    it("handles 'Token' singular form", () => {
      const output = "Token used: 1234 in, 567 out\n";
      const result = parseCodexCliTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 567 });
    });
  });
});
