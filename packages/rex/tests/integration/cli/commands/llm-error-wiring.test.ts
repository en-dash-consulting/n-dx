/**
 * Integration tests: LLM error classification wiring.
 *
 * Verifies that the classifyLLMError utility in the foundation layer
 * produces actionable output for the error scenarios that reshape,
 * reorganize, prune, and sourcevision analyze encounter. Also verifies
 * the re-export chain from llm-client → rex works correctly.
 */

import { describe, it, expect } from "vitest";
import { classifyLLMError } from "../../../../src/cli/llm-error-classifier.js";
import {
  classifyLLMError as foundationClassify,
  type LLMErrorClassification,
} from "@n-dx/llm-client";

// ── Foundation re-export integrity ─────────────────────────────────────

describe("classifyLLMError re-export chain", () => {
  it("rex re-exports the same function as the foundation", () => {
    // The rex module re-exports from @n-dx/llm-client — verify identity
    expect(classifyLLMError).toBe(foundationClassify);
  });

  it("is importable from both rex and @n-dx/llm-client", () => {
    expect(typeof classifyLLMError).toBe("function");
    expect(typeof foundationClassify).toBe("function");
  });
});

// ── Rate-limit error scenarios ─────────────────────────────────────────

describe("rate-limit error classification", () => {
  it("classifies 429 status code", () => {
    const r = classifyLLMError(new Error("429 Too Many Requests"));
    expect(r.category).toBe("rate-limit");
    expect(r.message).toContain("Rate limit");
    expect(r.suggestion).toMatch(/wait/i);
  });

  it("extracts retry-after duration when present", () => {
    const r = classifyLLMError(new Error("429 rate limited, retry-after: 30"));
    expect(r.category).toBe("rate-limit");
    expect(r.suggestion).toContain("30s");
  });

  it("handles retry-after without specific duration", () => {
    const r = classifyLLMError(new Error("rate limit exceeded"));
    expect(r.category).toBe("rate-limit");
    expect(r.suggestion).toMatch(/wait.*minutes/i);
  });

  it("suggests --model as alternative", () => {
    const r = classifyLLMError(new Error("429 Too Many Requests"));
    expect(r.suggestion).toContain("--model");
  });
});

// ── Budget exhaustion error scenarios ──────────────────────────────────

describe("budget-exceeded error classification", () => {
  it("classifies budget exceeded errors", () => {
    const r = classifyLLMError(new Error("budget exceeded: token limit reached"));
    expect(r.category).toBe("budget");
    expect(r.message).toContain("budget");
    expect(r.suggestion).toContain("ndx config");
  });

  it("classifies token limit exceeded", () => {
    const r = classifyLLMError(new Error("token limit exceeded for this project"));
    expect(r.category).toBe("budget");
    expect(r.suggestion).toContain("rex.budget.tokens");
  });

  it("suggests increasing via ndx config", () => {
    const r = classifyLLMError(new Error("budget exhausted, 0 tokens remaining"));
    expect(r.category).toBe("budget");
    expect(r.suggestion).toMatch(/ndx config.*budget/i);
  });
});

// ── Parse/malformed response error scenarios ───────────────────────────

describe("parse error classification", () => {
  it("classifies invalid JSON responses", () => {
    const r = classifyLLMError(new Error("Invalid JSON in LLM response: {broken"));
    expect(r.category).toBe("parse");
    expect(r.message).toContain("unparseable");
  });

  it("classifies schema validation failures", () => {
    const r = classifyLLMError(new Error("schema validation failed: missing required field"));
    expect(r.category).toBe("parse");
  });

  it("classifies truncated responses", () => {
    const r = classifyLLMError(new Error("response truncated at 4096 tokens"));
    expect(r.category).toBe("parse");
  });

  it("suggests retrying or different model", () => {
    const r = classifyLLMError(new Error("Invalid JSON in response"));
    expect(r.suggestion).toMatch(/try again|model/i);
  });
});

// ── Auth error scenarios ───────────────────────────────────────────────

describe("auth error classification", () => {
  it("classifies 401 errors", () => {
    const r = classifyLLMError(new Error("401 Unauthorized"));
    expect(r.category).toBe("auth");
    expect(r.message).toContain("Authentication failed");
  });

  it("provides codex-specific guidance when vendor is codex", () => {
    const r = classifyLLMError(new Error("401 Unauthorized"), "codex");
    expect(r.category).toBe("auth");
    expect(r.suggestion).toContain("codex login");
  });

  it("provides API key guidance for claude", () => {
    const r = classifyLLMError(new Error("401 Unauthorized"), "claude");
    expect(r.suggestion).toContain("n-dx config");
  });
});

// ── Server/overloaded error scenarios ──────────────────────────────────

describe("server error classification", () => {
  it("classifies 529 overloaded", () => {
    const r = classifyLLMError(new Error("529 Overloaded"));
    expect(r.category).toBe("server");
    expect(r.message).toContain("overloaded");
  });

  it("classifies 503 Service Unavailable", () => {
    const r = classifyLLMError(new Error("503 Service Unavailable"));
    expect(r.category).toBe("server");
  });

  it("suggests waiting and retrying", () => {
    const r = classifyLLMError(new Error("529 Overloaded"));
    expect(r.suggestion).toMatch(/wait.*retry/i);
  });
});

// ── Network error scenarios ────────────────────────────────────────────

describe("network error classification", () => {
  it("classifies ENOTFOUND", () => {
    const r = classifyLLMError(new Error("fetch failed: ENOTFOUND"));
    expect(r.category).toBe("network");
    expect(r.suggestion).toMatch(/internet.*connection/i);
  });

  it("classifies ECONNREFUSED", () => {
    const r = classifyLLMError(new Error("ECONNREFUSED localhost:8080"));
    expect(r.category).toBe("network");
  });
});

// ── Context label in command-specific usage ────────────────────────────

describe("context label integration", () => {
  it("reshape context appears in fallback message", () => {
    const r = classifyLLMError(new Error("some unknown error"), "claude", "analyze PRD structure");
    expect(r.category).toBe("unknown");
    expect(r.message).toContain("analyze PRD structure");
  });

  it("reorganize context appears in fallback message", () => {
    const r = classifyLLMError(new Error("unexpected error"), "claude", "reorganize PRD");
    expect(r.message).toContain("reorganize PRD");
  });

  it("prune context appears in fallback message", () => {
    const r = classifyLLMError(new Error("some error"), "claude", "identify prune candidates");
    expect(r.message).toContain("identify prune candidates");
  });

  it("sourcevision phase context appears in fallback message", () => {
    const r = classifyLLMError(new Error("some error"), "claude", "run phase 3 (classifications)");
    expect(r.message).toContain("run phase 3 (classifications)");
  });
});

// ── Structured return shape (all categories) ───────────────────────────

describe("return shape consistency", () => {
  const errorScenarios: Array<[string, Error, string]> = [
    ["auth", new Error("401 Unauthorized"), "auth"],
    ["rate-limit", new Error("429 Rate limit"), "rate-limit"],
    ["budget", new Error("budget exceeded"), "budget"],
    ["network", new Error("ENOTFOUND"), "network"],
    ["parse", new Error("invalid json"), "parse"],
    ["server", new Error("529 Overloaded"), "server"],
    ["unknown", new Error("mystery error"), "unknown"],
  ];

  for (const [label, err, expectedCategory] of errorScenarios) {
    it(`${label}: returns message, suggestion, and category`, () => {
      const r: LLMErrorClassification = classifyLLMError(err);
      expect(r).toHaveProperty("message");
      expect(r).toHaveProperty("suggestion");
      expect(r).toHaveProperty("category");
      expect(typeof r.message).toBe("string");
      expect(typeof r.suggestion).toBe("string");
      expect(r.message.length).toBeGreaterThan(0);
      expect(r.suggestion.length).toBeGreaterThan(0);
      expect(r.category).toBe(expectedCategory);
    });
  }
});
