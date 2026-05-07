/**
 * Unit tests for the foundation LLM error classifier.
 *
 * Ensures classifyLLMError produces correct categories, messages,
 * and actionable suggestions for all known error patterns.
 */

import { describe, it, expect } from "vitest";
import {
  classifyLLMError,
  type LLMErrorCategory,
  type LLMErrorClassification,
  type LLMErrorContext,
} from "../../src/llm-error-classifier.js";

describe("classifyLLMError", () => {
  // ── auth category ─────────────────────────────────────────────────

  it("classifies 401 as auth", () => {
    const r = classifyLLMError(new Error("401 Unauthorized"));
    expect(r.category).toBe("auth");
    expect(r.message).toContain("Authentication failed");
  });

  it("classifies invalid API key as auth", () => {
    const r = classifyLLMError(new Error("Invalid API key provided"));
    expect(r.category).toBe("auth");
  });

  it("uses codex-specific messaging for codex vendor", () => {
    const r = classifyLLMError(new Error("401 Unauthorized"), "codex");
    expect(r.category).toBe("auth");
    expect(r.message).toContain("Codex CLI");
    expect(r.suggestion).toContain("codex login");
  });

  // ── rate-limit category ───────────────────────────────────────────

  it("classifies 429 as rate-limit", () => {
    const r = classifyLLMError(new Error("429 Too Many Requests"));
    expect(r.category).toBe("rate-limit");
    expect(r.message).toContain("Rate limit");
  });

  it("extracts retry-after duration from message text", () => {
    const r = classifyLLMError(new Error("429 rate limited, retry-after: 45"));
    expect(r.category).toBe("rate-limit");
    expect(r.suggestion).toContain("45s");
  });

  it("uses structured retryAfterSeconds from context", () => {
    const r = classifyLLMError(
      new Error("429 Too Many Requests"),
      "claude",
      { retryAfterSeconds: 47 },
    );
    expect(r.category).toBe("rate-limit");
    expect(r.suggestion).toContain("47s");
  });

  it("formats multi-minute countdown from retryAfterSeconds", () => {
    const r = classifyLLMError(
      new Error("rate limit exceeded"),
      "claude",
      { retryAfterSeconds: 150 },
    );
    expect(r.suggestion).toContain("2m 30s");
  });

  it("falls back to generic wait when no retry-after", () => {
    const r = classifyLLMError(new Error("rate limit exceeded"));
    expect(r.category).toBe("rate-limit");
    expect(r.suggestion).toMatch(/wait.*minutes/i);
  });

  // ── budget category ───────────────────────────────────────────────

  it("classifies budget exceeded", () => {
    const r = classifyLLMError(new Error("budget exceeded"));
    expect(r.category).toBe("budget");
    expect(r.suggestion).toContain("ndx config");
  });

  it("classifies token limit exceeded", () => {
    const r = classifyLLMError(new Error("token limit exceeded for this project"));
    expect(r.category).toBe("budget");
  });

  it("includes usage vs limit when budget context provided", () => {
    const r = classifyLLMError(
      new Error("budget exceeded"),
      "claude",
      { budgetUsed: 150_000, budgetLimit: 200_000 },
    );
    expect(r.category).toBe("budget");
    expect(r.message).toContain("150,000");
    expect(r.message).toContain("200,000");
  });

  // ── timeout category ──────────────────────────────────────────────

  it("classifies network timeout (ETIMEDOUT)", () => {
    const r = classifyLLMError(new Error("connect ETIMEDOUT 1.2.3.4:443"));
    expect(r.category).toBe("network");
    expect(r.suggestion).toMatch(/connection/i);
  });

  it("classifies API timeout (generic timeout)", () => {
    const r = classifyLLMError(new Error("Request timeout after 300000ms"));
    expect(r.category).toBe("timeout");
    expect(r.suggestion).toMatch(/reducing input|smaller/i);
  });

  it("classifies 408 as API timeout", () => {
    const r = classifyLLMError(new Error("408 Request Timeout"));
    expect(r.category).toBe("timeout");
  });

  it("classifies socket hang up as network timeout", () => {
    const r = classifyLLMError(new Error("socket hang up timeout"));
    expect(r.category).toBe("network");
  });

  // ── parse category ────────────────────────────────────────────────

  it("classifies invalid JSON as parse", () => {
    const r = classifyLLMError(new Error("Invalid JSON in LLM response"));
    expect(r.category).toBe("parse");
    expect(r.message).toContain("unparseable");
  });

  it("classifies schema validation as parse", () => {
    const r = classifyLLMError(new Error("schema validation failed"));
    expect(r.category).toBe("parse");
  });

  it("classifies truncated as parse", () => {
    const r = classifyLLMError(new Error("response truncated at 4096 tokens"));
    expect(r.category).toBe("parse");
  });

  it("surfaces [ndx-debug:<path>] sentinel and underlying detail in parse branch", () => {
    const err = new Error(
      "LLM response failed schema validation: features.0.tasks: Required [ndx-debug:/tmp/ndx-add-failure-2026-05-07T10-00-00-000Z.txt]",
    );
    const r = classifyLLMError(err);
    expect(r.category).toBe("parse");
    expect(r.message).toContain("unparseable");
    expect(r.message).toContain(
      "Raw response saved to /tmp/ndx-add-failure-2026-05-07T10-00-00-000Z.txt",
    );
    expect(r.message).toContain("Underlying error:");
    expect(r.message).toContain("features.0.tasks: Required");
    // Sentinel itself must not leak into the surfaced message.
    expect(r.message).not.toContain("[ndx-debug:");
    expect(r.suggestion).toContain("Inspect the captured response");
  });

  it("does not append debug detail when no sentinel is present", () => {
    const r = classifyLLMError(new Error("Invalid JSON in LLM response"));
    expect(r.category).toBe("parse");
    expect(r.message).not.toContain("Raw response saved to");
    expect(r.message).not.toContain("Underlying error:");
    expect(r.suggestion).not.toContain("Inspect the captured response");
  });

  // ── network category ──────────────────────────────────────────────

  it("classifies ENOTFOUND as network", () => {
    const r = classifyLLMError(new Error("ENOTFOUND"));
    expect(r.category).toBe("network");
  });

  it("classifies ECONNREFUSED as network", () => {
    const r = classifyLLMError(new Error("ECONNREFUSED"));
    expect(r.category).toBe("network");
  });

  it("classifies fetch failed as network", () => {
    const r = classifyLLMError(new Error("fetch failed"));
    expect(r.category).toBe("network");
  });

  // ── server category ───────────────────────────────────────────────

  it("classifies 529 overloaded as server", () => {
    const r = classifyLLMError(new Error("529 Overloaded"));
    expect(r.category).toBe("server");
  });

  it("classifies 503 as server", () => {
    const r = classifyLLMError(new Error("503 Service Unavailable"));
    expect(r.category).toBe("server");
  });

  // ── unknown category (fallback) ───────────────────────────────────

  it("falls back to unknown for unrecognized errors", () => {
    const r = classifyLLMError(new Error("something unexpected"));
    expect(r.category).toBe("unknown");
    expect(r.message).toContain("something unexpected");
  });

  it("uses context label in fallback message", () => {
    const r = classifyLLMError(new Error("unexpected"), "claude", "analyze PRD");
    expect(r.message).toContain("analyze PRD");
  });

  it("uses LLMErrorContext.label in fallback message", () => {
    const r = classifyLLMError(new Error("unexpected"), "claude", { label: "run phase" });
    expect(r.message).toContain("run phase");
  });

  // ── error context suffix ──────────────────────────────────────────

  it("includes command, vendor, and model in error message suffix", () => {
    const r = classifyLLMError(
      new Error("429 Too Many Requests"),
      "claude",
      { command: "ndx plan", model: "claude-sonnet-4-6" },
    );
    expect(r.message).toContain("[ndx plan · claude · claude-sonnet-4-6]");
  });

  it("includes just vendor when only command is missing", () => {
    const r = classifyLLMError(
      new Error("429 Too Many Requests"),
      "claude",
      { model: "claude-sonnet-4-6" },
    );
    expect(r.message).toContain("[claude · claude-sonnet-4-6]");
  });

  it("omits suffix for plain string context", () => {
    const r = classifyLLMError(
      new Error("429 Too Many Requests"),
      "claude",
      "analyze PRD",
    );
    // No brackets in message (string context = label only, no suffix)
    expect(r.message).not.toContain("[");
  });

  it("omits suffix when no context provided", () => {
    const r = classifyLLMError(new Error("429 Too Many Requests"));
    expect(r.message).not.toContain("[");
  });

  // ── structured return ─────────────────────────────────────────────

  it("all categories return message, suggestion, category", () => {
    const cases: Array<[Error, LLMErrorCategory]> = [
      [new Error("401 Unauthorized"), "auth"],
      [new Error("429 Rate limit"), "rate-limit"],
      [new Error("budget exceeded"), "budget"],
      [new Error("ENOTFOUND"), "network"],
      [new Error("invalid json"), "parse"],
      [new Error("529 Overloaded"), "server"],
      [new Error("unknown"), "unknown"],
    ];

    for (const [err, expected] of cases) {
      const r: LLMErrorClassification = classifyLLMError(err);
      expect(r.message).toBeTruthy();
      expect(r.suggestion).toBeTruthy();
      expect(r.category).toBe(expected);
    }
  });
});
