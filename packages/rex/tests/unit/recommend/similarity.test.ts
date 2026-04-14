import { describe, it, expect } from "vitest";
import { similarity } from "../../../src/recommend/similarity.js";

describe("similarity", () => {
  describe("edge cases", () => {
    it("returns 0 for empty first string", () => {
      expect(similarity("", "something")).toBe(0);
    });

    it("returns 0 for empty second string", () => {
      expect(similarity("something", "")).toBe(0);
    });

    it("returns 0 for both empty strings", () => {
      expect(similarity("", "")).toBe(0);
    });

    it("returns 1.0 for identical strings", () => {
      expect(similarity("implement authentication", "implement authentication")).toBe(1.0);
    });

    it("returns 1.0 after normalization (case, whitespace)", () => {
      expect(similarity("  Add  Feature  ", "add feature")).toBe(1.0);
    });
  });

  describe("action synonym grouping", () => {
    it("scores add and implement as near-equivalent for same content", () => {
      // Both map to 'implement' canonical verb
      const score = similarity("add authentication module", "implement authentication module");
      expect(score).toBeGreaterThan(0.7);
    });

    it("scores create and build as near-equivalent for same content", () => {
      const score = similarity("create user service", "build user service");
      expect(score).toBeGreaterThan(0.7);
    });

    it("scores refactor and restructure as near-equivalent for same content", () => {
      const score = similarity("refactor auth module", "restructure auth module");
      expect(score).toBeGreaterThan(0.7);
    });

    it("scores fix and resolve as near-equivalent for same content", () => {
      const score = similarity("fix login bug", "resolve login bug");
      expect(score).toBeGreaterThan(0.7);
    });

    it("scores update and upgrade as near-equivalent for same content", () => {
      const score = similarity("update database schema", "upgrade database schema");
      expect(score).toBeGreaterThan(0.7);
    });

    it("scores remove and delete as near-equivalent for same content", () => {
      const score = similarity("remove legacy code", "delete legacy code");
      expect(score).toBeGreaterThan(0.7);
    });

    it("scores different action synonyms (implement vs fix) lower than same-synonym pairs", () => {
      const sameSynonym = similarity("add auth service", "implement auth service");
      const differentSynonym = similarity("add auth service", "fix auth service");
      expect(sameSynonym).toBeGreaterThan(differentSynonym);
    });
  });

  describe("content similarity", () => {
    it("scores strings with similar content above 0.5", () => {
      const score = similarity("fix login authentication bug", "fix login auth error");
      expect(score).toBeGreaterThan(0.5);
    });

    it("scores completely different strings below 0.3", () => {
      const score = similarity(
        "implement database connection pool",
        "fix UI layout spacing issue",
      );
      expect(score).toBeLessThan(0.3);
    });

    it("handles containment (one string inside the other)", () => {
      // rawSimilarity uses containment check: score >= 0.7 for contained strings
      const score = similarity("add user authentication system", "add authentication");
      expect(score).toBeGreaterThan(0.5);
    });

    it("scores partial word overlap proportionally", () => {
      const high = similarity("implement auth module", "implement auth system");
      const low = similarity("implement auth module", "implement logging");
      expect(high).toBeGreaterThan(low);
    });
  });

  describe("symmetry", () => {
    it("returns the same score regardless of argument order", () => {
      const a = "fix authentication bug";
      const b = "resolve login error";
      expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 5);
    });
  });

  describe("score range", () => {
    it("always returns a value between 0 and 1 inclusive", () => {
      const pairs = [
        ["add tests", "fix bug"],
        ["implement feature x", "implement feature x"],
        ["", "hello"],
        ["completely unrelated text here", "totally different words altogether"],
      ];
      for (const [a, b] of pairs) {
        const score = similarity(a!, b!);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });
  });
});
