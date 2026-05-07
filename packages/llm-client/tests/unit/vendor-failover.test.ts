import { describe, it, expect } from "vitest";
import { getNextFailoverAttempt } from "../../src/vendor-failover.js";
import { TIER_MODELS } from "../../src/config.js";

describe("getNextFailoverAttempt", () => {
  describe("Claude-origin chain", () => {
    // Claude starts at sonnet (standard tier), failover chain is:
    // 1. haiku (claude light)
    // 2. gpt-5.5 (codex standard)
    // 3. gpt-5.4-mini (codex light)
    // 4+ exhausted

    it("returns haiku on first failover attempt", () => {
      const result = getNextFailoverAttempt(1, "claude");
      expect(result).toEqual({
        isExhausted: false,
        vendor: "claude",
        model: TIER_MODELS.claude.light,
      });
    });

    it("returns codex standard on second failover attempt", () => {
      const result = getNextFailoverAttempt(2, "claude");
      expect(result).toEqual({
        isExhausted: false,
        vendor: "codex",
        model: TIER_MODELS.codex.standard,
      });
    });

    it("returns codex light on third failover attempt", () => {
      const result = getNextFailoverAttempt(3, "claude");
      expect(result).toEqual({
        isExhausted: false,
        vendor: "codex",
        model: TIER_MODELS.codex.light,
      });
    });

    it("returns exhausted on fourth failover attempt", () => {
      const result = getNextFailoverAttempt(4, "claude");
      expect(result).toEqual({
        isExhausted: true,
      });
    });

    it("returns exhausted on fifth and beyond attempts", () => {
      expect(getNextFailoverAttempt(5, "claude")).toEqual({
        isExhausted: true,
      });
      expect(getNextFailoverAttempt(10, "claude")).toEqual({
        isExhausted: true,
      });
    });
  });

  describe("Codex-origin chain", () => {
    // Codex starts at gpt-5.5 (standard tier), failover chain is:
    // 1. gpt-5.4-mini (codex light)
    // 2. claude-sonnet-4-6 (claude standard)
    // 3. claude-haiku-4-20250414 (claude light)
    // 4+ exhausted

    it("returns codex light on first failover attempt", () => {
      const result = getNextFailoverAttempt(1, "codex");
      expect(result).toEqual({
        isExhausted: false,
        vendor: "codex",
        model: TIER_MODELS.codex.light,
      });
    });

    it("returns claude standard on second failover attempt", () => {
      const result = getNextFailoverAttempt(2, "codex");
      expect(result).toEqual({
        isExhausted: false,
        vendor: "claude",
        model: TIER_MODELS.claude.standard,
      });
    });

    it("returns claude light on third failover attempt", () => {
      const result = getNextFailoverAttempt(3, "codex");
      expect(result).toEqual({
        isExhausted: false,
        vendor: "claude",
        model: TIER_MODELS.claude.light,
      });
    });

    it("returns exhausted on fourth failover attempt", () => {
      const result = getNextFailoverAttempt(4, "codex");
      expect(result).toEqual({
        isExhausted: true,
      });
    });

    it("returns exhausted on fifth and beyond attempts", () => {
      expect(getNextFailoverAttempt(5, "codex")).toEqual({
        isExhausted: true,
      });
      expect(getNextFailoverAttempt(10, "codex")).toEqual({
        isExhausted: true,
      });
    });
  });

  describe("attempt 0 (original attempt)", () => {
    // Attempt 0 should not be called by failover logic (it's the original),
    // but if called, it should indicate exhaustion since there's no "failover"
    // at attempt 0 — the original attempt is not a failover attempt.
    it("returns exhausted for attempt 0 with claude origin", () => {
      const result = getNextFailoverAttempt(0, "claude");
      expect(result).toEqual({
        isExhausted: true,
      });
    });

    it("returns exhausted for attempt 0 with codex origin", () => {
      const result = getNextFailoverAttempt(0, "codex");
      expect(result).toEqual({
        isExhausted: true,
      });
    });
  });

  describe("custom config with tier overrides", () => {
    it("uses custom claude light model when provided", () => {
      const customConfig = {
        claude: { lightModel: "claude-opus-4-7" },
      };
      const result = getNextFailoverAttempt(1, "claude", customConfig);
      expect(result).toEqual({
        isExhausted: false,
        vendor: "claude",
        model: "claude-opus-4-7",
      });
    });

    it("uses custom claude standard model when provided", () => {
      const customConfig = {
        claude: { model: "custom-claude-sonnet" },
      };
      const result = getNextFailoverAttempt(2, "codex", customConfig);
      expect(result).toEqual({
        isExhausted: false,
        vendor: "claude",
        model: "custom-claude-sonnet",
      });
    });

    it("uses custom codex light model when provided", () => {
      const customConfig = {
        codex: { lightModel: "gpt-5.4-turbo" },
      };
      const result = getNextFailoverAttempt(1, "codex", customConfig);
      expect(result).toEqual({
        isExhausted: false,
        vendor: "codex",
        model: "gpt-5.4-turbo",
      });
    });

    it("uses custom codex standard model when provided", () => {
      const customConfig = {
        codex: { model: "custom-codex" },
      };
      const result = getNextFailoverAttempt(2, "claude", customConfig);
      expect(result).toEqual({
        isExhausted: false,
        vendor: "codex",
        model: "custom-codex",
      });
    });
  });

  describe("failover chain documentation", () => {
    it("documents the maximum chain length of 3 failover attempts for any vendor", () => {
      // Attempt 1, 2, 3 are valid failover attempts
      expect(getNextFailoverAttempt(1, "claude").isExhausted).toBe(false);
      expect(getNextFailoverAttempt(2, "claude").isExhausted).toBe(false);
      expect(getNextFailoverAttempt(3, "claude").isExhausted).toBe(false);
      expect(getNextFailoverAttempt(4, "claude").isExhausted).toBe(true);

      expect(getNextFailoverAttempt(1, "codex").isExhausted).toBe(false);
      expect(getNextFailoverAttempt(2, "codex").isExhausted).toBe(false);
      expect(getNextFailoverAttempt(3, "codex").isExhausted).toBe(false);
      expect(getNextFailoverAttempt(4, "codex").isExhausted).toBe(true);
    });
  });
});
