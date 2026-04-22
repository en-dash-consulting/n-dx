import { describe, it, expect } from "vitest";
import {
  classifyLLMError,
  type LLMErrorClassification,
} from "../../../src/cli/llm-error-classifier.js";

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

  it("classifies authentication-failed pattern as auth", () => {
    const r = classifyLLMError(new Error("authentication failed: invalid token"));
    expect(r.category).toBe("auth");
  });

  it("classifies unauthorized-request pattern as auth", () => {
    const r = classifyLLMError(new Error("unauthorized request: check credentials"));
    expect(r.category).toBe("auth");
  });

  it("uses codex-specific messaging when vendor is codex", () => {
    const r = classifyLLMError(new Error("401 Unauthorized"), "codex");
    expect(r.category).toBe("auth");
    expect(r.message).toContain("Codex CLI");
    expect(r.suggestion).toContain("codex login");
  });

  it("does not false-positive on user input containing 'authentication'", () => {
    const r = classifyLLMError(
      new Error("LLM failed: unexpected response for input: Add authentication for unauthorized API calls"),
    );
    // "authentication" followed by "for" doesn't match "authentication.*(fail|error|invalid|expired)"
    // and "unauthorized" followed by "API calls" doesn't match "unauthorized.*(request|access|error)"
    expect(r.category).not.toBe("auth");
  });

  // ── rate-limit category ───────────────────────────────────────────

  it("classifies 429 as rate-limit", () => {
    const r = classifyLLMError(new Error("429 Too Many Requests"));
    expect(r.category).toBe("rate-limit");
    expect(r.message).toContain("Rate limit");
  });

  it("classifies 'rate limit' text as rate-limit", () => {
    const r = classifyLLMError(new Error("rate limit exceeded"));
    expect(r.category).toBe("rate-limit");
  });

  it("classifies 'too many requests' as rate-limit", () => {
    const r = classifyLLMError(new Error("too many requests, slow down"));
    expect(r.category).toBe("rate-limit");
  });

  it("classifies retry-after as rate-limit", () => {
    const r = classifyLLMError(new Error("retry-after: 30 seconds"));
    expect(r.category).toBe("rate-limit");
  });

  // ── budget category ───────────────────────────────────────────────

  it("classifies budget exceeded as budget", () => {
    const r = classifyLLMError(new Error("budget exceeded: token limit reached"));
    expect(r.category).toBe("budget");
  });

  it("classifies token limit exceeded as budget", () => {
    const r = classifyLLMError(new Error("token limit exceeded for this session"));
    expect(r.category).toBe("budget");
  });

  // ── network category ──────────────────────────────────────────────

  it("classifies ENOTFOUND as network", () => {
    const r = classifyLLMError(new Error("fetch failed: ENOTFOUND"));
    expect(r.category).toBe("network");
    expect(r.message).toContain("Network error");
  });

  it("classifies ECONNREFUSED as network", () => {
    const r = classifyLLMError(new Error("ECONNREFUSED localhost:8080"));
    expect(r.category).toBe("network");
  });

  it("classifies ETIMEDOUT as network", () => {
    const r = classifyLLMError(new Error("ETIMEDOUT connecting to api.example.com"));
    expect(r.category).toBe("network");
  });

  it("classifies fetch failed as network", () => {
    const r = classifyLLMError(new Error("fetch failed"));
    expect(r.category).toBe("network");
  });

  // ── parse category ────────────────────────────────────────────────

  it("classifies invalid JSON as parse", () => {
    const r = classifyLLMError(new Error("Invalid JSON in LLM response: {broken"));
    expect(r.category).toBe("parse");
    expect(r.message).toContain("unparseable");
  });

  it("classifies schema validation as parse", () => {
    const r = classifyLLMError(new Error("schema validation failed: missing 'items' field"));
    expect(r.category).toBe("parse");
  });

  it("classifies truncated response as parse", () => {
    const r = classifyLLMError(new Error("response truncated at 4096 tokens"));
    expect(r.category).toBe("parse");
  });

  // ── server category ───────────────────────────────────────────────

  it("classifies 529 overloaded as server", () => {
    const r = classifyLLMError(new Error("529 Overloaded"));
    expect(r.category).toBe("server");
    expect(r.message).toContain("overloaded");
  });

  it("classifies 503 as server", () => {
    const r = classifyLLMError(new Error("503 Service Unavailable"));
    expect(r.category).toBe("server");
  });

  it("classifies 500 as server", () => {
    const r = classifyLLMError(new Error("500 Internal Server Error"));
    expect(r.category).toBe("server");
  });

  it("classifies 'server error' text as server", () => {
    const r = classifyLLMError(new Error("server error: try again later"));
    expect(r.category).toBe("server");
  });

  // ── unknown category (fallback) ───────────────────────────────────

  it("falls back to unknown for unrecognized errors", () => {
    const r = classifyLLMError(new Error("something completely unexpected"));
    expect(r.category).toBe("unknown");
    expect(r.message).toContain("something completely unexpected");
  });

  it("uses context label in fallback message", () => {
    const r = classifyLLMError(
      new Error("unexpected"),
      "claude",
      "analyze description",
    );
    expect(r.message).toContain("analyze description");
  });

  it("uses default context when none provided", () => {
    const r = classifyLLMError(new Error("unexpected"));
    expect(r.message).toContain("complete the request");
  });

  it("uses codex-specific fallback suggestion", () => {
    const r = classifyLLMError(new Error("unexpected"), "codex");
    expect(r.suggestion).toContain("codex login");
  });

  // ── structured return shape ───────────────────────────────────────

  it("returns all three fields for every category", () => {
    const errors: Array<[Error, string]> = [
      [new Error("401 Unauthorized"), "auth"],
      [new Error("429 Rate limit"), "rate-limit"],
      [new Error("budget exceeded"), "budget"],
      [new Error("ENOTFOUND"), "network"],
      [new Error("invalid json"), "parse"],
      [new Error("529 Overloaded"), "server"],
      [new Error("mystery"), "unknown"],
    ];

    for (const [err, expectedCategory] of errors) {
      const r: LLMErrorClassification = classifyLLMError(err);
      expect(r).toHaveProperty("message");
      expect(r).toHaveProperty("suggestion");
      expect(r).toHaveProperty("category");
      expect(typeof r.message).toBe("string");
      expect(typeof r.suggestion).toBe("string");
      expect(r.category).toBe(expectedCategory);
    }
  });
});
