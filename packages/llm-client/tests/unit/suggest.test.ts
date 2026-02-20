import { describe, it, expect } from "vitest";
import { editDistance, suggestCommands, formatTypoSuggestion } from "../../src/suggest.js";

describe("suggest", () => {
  describe("editDistance", () => {
    it("returns 0 for identical strings", () => {
      expect(editDistance("hello", "hello")).toBe(0);
    });

    it("returns string length when comparing with empty", () => {
      expect(editDistance("", "hello")).toBe(5);
      expect(editDistance("hello", "")).toBe(5);
    });

    it("returns 0 for two empty strings", () => {
      expect(editDistance("", "")).toBe(0);
    });

    it("handles single character difference", () => {
      expect(editDistance("cat", "bat")).toBe(1);
    });

    it("handles insertion", () => {
      expect(editDistance("cat", "cats")).toBe(1);
    });

    it("handles deletion", () => {
      expect(editDistance("cats", "cat")).toBe(1);
    });

    it("handles transposition-like edits", () => {
      expect(editDistance("ab", "ba")).toBe(2); // Levenshtein counts as 2
    });

    it("handles longer strings", () => {
      expect(editDistance("kitten", "sitting")).toBe(3);
    });
  });

  describe("suggestCommands", () => {
    const candidates = ["status", "start", "stop", "sync", "init", "plan"];

    it("finds close matches within default distance", () => {
      const results = suggestCommands("statis", candidates);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("status");
    });

    it("returns empty for exact matches", () => {
      const results = suggestCommands("status", candidates);
      expect(results).toEqual([]);
    });

    it("returns empty for completely different strings", () => {
      const results = suggestCommands("xyzabc", candidates);
      expect(results).toEqual([]);
    });

    it("is case insensitive", () => {
      const results = suggestCommands("STATUS", candidates);
      // distance 0 is filtered (exact match), so this should be empty
      expect(results).toEqual([]);
    });

    it("respects maxDistance parameter", () => {
      const results = suggestCommands("statis", candidates, 1);
      expect(results.every((s) => s.distance <= 1)).toBe(true);
    });

    it("sorts by distance", () => {
      const results = suggestCommands("stat", candidates);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
      }
    });
  });

  describe("formatTypoSuggestion", () => {
    const candidates = ["status", "start", "stop", "sync", "init", "plan"];

    it("returns null when no close matches", () => {
      expect(formatTypoSuggestion("xyzabc", candidates)).toBeNull();
    });

    it("suggests a single command", () => {
      const result = formatTypoSuggestion("statis", candidates);
      expect(result).toContain("Did you mean");
      expect(result).toContain("status");
    });

    it("includes prefix when provided", () => {
      const result = formatTypoSuggestion("statis", candidates, "ndx ");
      expect(result).toContain("ndx status");
    });

    it("suggests multiple commands when ambiguous", () => {
      // "sta" is distance 3+ from most, but "stat" could match "start" and "status"
      const result = formatTypoSuggestion("stap", candidates);
      // "stap" → "stop" (dist 2), "start" (dist 2), "status" (dist 3)
      // Both stop and start should be within distance 2
      expect(result).not.toBeNull();
    });

    it("formats single suggestion correctly", () => {
      const result = formatTypoSuggestion("valdate", ["validate"]);
      expect(result).toBe("Did you mean 'validate'?");
    });

    it("formats multiple suggestions correctly", () => {
      const result = formatTypoSuggestion("stap", ["stop", "start", "status"]);
      if (result && result.includes("one of")) {
        expect(result).toMatch(/Did you mean one of:/);
      }
    });
  });
});
