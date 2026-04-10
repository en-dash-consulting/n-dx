import { describe, it, expect } from "vitest";
import { formatQuotaLog } from "../../../src/quota/format.js";
import type { QuotaRemaining } from "../../../src/quota/types.js";

// ANSI escape code constants mirrored from the implementation so the tests
// remain readable without coupling to implementation internals.
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function quota(vendor: string, model: string, percentRemaining: number): QuotaRemaining {
  return { vendor, model, percentRemaining };
}

describe("formatQuotaLog", () => {
  // ── Empty input ──────────────────────────────────────────────────────────
  describe("when the input array is empty", () => {
    it("returns an empty array", () => {
      expect(formatQuotaLog([])).toEqual([]);
    });

    it("allows callers to guard with .length", () => {
      const lines = formatQuotaLog([]);
      expect(lines.length).toBe(0);
    });
  });

  // ── Default color (>= 10 %) ──────────────────────────────────────────────
  describe("when percentRemaining is >= 10 %", () => {
    it("uses no ANSI color codes at exactly 10 %", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 10)]);
      expect(line).not.toContain(RED);
      expect(line).not.toContain(YELLOW);
      expect(line).not.toContain(RESET);
    });

    it("uses no ANSI color codes at 42 %", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-sonnet-4-5", 42)]);
      expect(line).not.toContain(RED);
      expect(line).not.toContain(YELLOW);
    });

    it("uses no ANSI color codes at 100 %", () => {
      const [line] = formatQuotaLog([quota("codex", "gpt-4o", 100)]);
      expect(line).not.toContain(RED);
      expect(line).not.toContain(YELLOW);
    });

    it("includes the vendor, model, and percent value in the output", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 42)]);
      expect(line).toContain("claude");
      expect(line).toContain("claude-opus-4-5");
      expect(line).toContain("42%");
    });
  });

  // ── Yellow (5 % <= x < 10 %) ─────────────────────────────────────────────
  describe("when percentRemaining is >= 5 % and < 10 %", () => {
    it("applies yellow at exactly 5 %", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 5)]);
      expect(line).toContain(YELLOW);
      expect(line).not.toContain(RED);
      expect(line).toContain(RESET);
    });

    it("applies yellow at 8 %", () => {
      const [line] = formatQuotaLog([quota("codex", "gpt-4o", 8)]);
      expect(line).toContain(YELLOW);
      expect(line).not.toContain(RED);
    });

    it("applies yellow at 9.9 %", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 9.9)]);
      expect(line).toContain(YELLOW);
      expect(line).not.toContain(RED);
    });

    it("includes RESET after the text when yellow is applied", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 7)]);
      expect(line.endsWith(RESET)).toBe(true);
    });

    it("includes vendor, model, and percent value in yellow output", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-sonnet-4-5", 8)]);
      expect(line).toContain("claude");
      expect(line).toContain("claude-sonnet-4-5");
      expect(line).toContain("8%");
    });
  });

  // ── Red (< 5 %) ──────────────────────────────────────────────────────────
  describe("when percentRemaining is < 5 %", () => {
    it("applies red at exactly 0 %", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 0)]);
      expect(line).toContain(RED);
      expect(line).not.toContain(YELLOW);
      expect(line).toContain(RESET);
    });

    it("applies red at 3 %", () => {
      const [line] = formatQuotaLog([quota("codex", "gpt-4o", 3)]);
      expect(line).toContain(RED);
      expect(line).not.toContain(YELLOW);
    });

    it("applies red at 4.9 %", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 4.9)]);
      expect(line).toContain(RED);
      expect(line).not.toContain(YELLOW);
    });

    it("includes RESET after the text when red is applied", () => {
      const [line] = formatQuotaLog([quota("codex", "gpt-4o", 2)]);
      expect(line.endsWith(RESET)).toBe(true);
    });

    it("includes vendor, model, and percent value in red output", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 3)]);
      expect(line).toContain("claude");
      expect(line).toContain("claude-opus-4-5");
      expect(line).toContain("3%");
    });
  });

  // ── Multiple entries ──────────────────────────────────────────────────────
  describe("with multiple entries", () => {
    it("returns one string per input entry", () => {
      const quotas = [
        quota("claude", "claude-opus-4-5", 42),
        quota("codex", "gpt-4o", 7),
        quota("claude", "claude-sonnet-4-5", 2),
      ];
      expect(formatQuotaLog(quotas)).toHaveLength(3);
    });

    it("applies the correct color to each entry independently", () => {
      const quotas = [
        quota("claude", "claude-opus-4-5", 42), // default
        quota("codex", "gpt-4o", 7),             // yellow
        quota("claude", "claude-sonnet-4-5", 2), // red
      ];
      const [defaultLine, yellowLine, redLine] = formatQuotaLog(quotas);

      expect(defaultLine).not.toContain(RED);
      expect(defaultLine).not.toContain(YELLOW);

      expect(yellowLine).toContain(YELLOW);
      expect(yellowLine).not.toContain(RED);

      expect(redLine).toContain(RED);
      expect(redLine).not.toContain(YELLOW);
    });
  });

  // ── Output format ─────────────────────────────────────────────────────────
  describe("output format", () => {
    it("rounds fractional percent values in the label", () => {
      // 7.6 rounds to 8
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 7.6)]);
      expect(line).toContain("8%");
    });

    it("includes 'remaining' in the label", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 50)]);
      expect(line).toContain("remaining");
    });

    it("separates vendor and model with ' / '", () => {
      const [line] = formatQuotaLog([quota("claude", "claude-opus-4-5", 50)]);
      expect(line).toContain("claude / claude-opus-4-5");
    });
  });
});
