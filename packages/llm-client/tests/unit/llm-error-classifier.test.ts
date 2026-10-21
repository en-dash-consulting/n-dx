/**
 * Unit tests for the foundation LLM error classifier.
 *
 * Ensures classifyLLMError produces correct categories, messages,
 * and actionable suggestions for all known error patterns.
 */

import { describe, it, expect } from "vitest";
import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../../../lang-kit/tests/helpers/call-within-budget.js";
import {
  classifyLLMError,
  extractProviderDetail,
  isAuthError,
  parseAuthPayload,
  classifyAuthError,
  type LLMErrorCategory,
  type LLMErrorClassification,
  type LLMErrorContext,
} from "../../src/llm-error-classifier.js";
import { AuthFailureError, ClaudeClientError } from "../../src/types.js";

const CLASSIFIER = new URL("../../src/llm-error-classifier.ts", import.meta.url);

describe("classifyLLMError", () => {
  // ── auth category ─────────────────────────────────────────────────

  it("classifies 401 as auth with canonical re-auth guidance", () => {
    const r = classifyLLMError(new Error("401 Unauthorized"));
    expect(r.category).toBe("auth");
    expect(r.message).toContain("Authentication failed for Claude");
    expect(r.message).toContain("Invalid or expired credentials");
    expect(r.suggestion).toContain("claude logout && claude login");
  });

  it("classifies invalid API key as auth", () => {
    const r = classifyLLMError(new Error("Invalid API key provided"));
    expect(r.category).toBe("auth");
  });

  it("classifies a lost CLI session as auth with re-auth guidance (codex)", () => {
    const r = classifyLLMError(
      new Error("Not logged in. Please run codex login to continue."),
      "codex",
    );
    expect(r.category).toBe("auth");
    expect(r.suggestion).toContain("codex login");
  });

  it("classifies an expired session as auth", () => {
    const r = classifyLLMError(new Error("Your session has expired"));
    expect(r.category).toBe("auth");
  });

  it("uses codex-specific messaging for codex vendor", () => {
    const r = classifyLLMError(new Error("401 Unauthorized"), "codex");
    expect(r.category).toBe("auth");
    expect(r.message).toContain("Authentication failed for Codex");
    expect(r.suggestion).toContain("codex logout && codex login");
  });

  it("uses google-specific messaging for google vendor auth error", () => {
    const r = classifyLLMError(new Error("401 Unauthorized"), "google");
    expect(r.category).toBe("auth");
    expect(r.message).toContain("Authentication failed for Google");
    expect(r.suggestion).toContain("llm.google.api_key");
    expect(r.suggestion).toContain("GEMINI_API_KEY");
  });

  it("uses google hint in fallback for unknown google errors", () => {
    const r = classifyLLMError(new Error("something unexpected"), "google");
    expect(r.category).toBe("unknown");
    expect(r.suggestion).toContain("GEMINI_API_KEY");
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

  // The sentinel's producer (rex's throwParseFailure) writes `<message> [ndx-debug:<path>]`
  // with exactly one space, so the extractor takes at most one; the trailing
  // trim() keeps the cleaned message the same whatever whitespace preceded it.
  // The sentinel sits at the end of the message, so this path reads the whole
  // message rather than a bounded window, and has to stay linear on its own.
  describe("sentinel extraction on pathological input", { timeout: BOUNDED_TEST_TIMEOUT_MS }, () => {
    it("is linear on a long run of spaces before the sentinel", async () => {
      const err = new Error(`Invalid JSON in LLM response${" ".repeat(20_000)}[ndx-debug:x]`);
      const r = await callWithinBudget<typeof classifyLLMError>(CLASSIFIER, "classifyLLMError", err);
      expect(r.category).toBe("parse");
      expect(r.message).toContain("Raw response saved to x.");
      expect(r.message).toContain("Underlying error: Invalid JSON in LLM response.");
      expect(r.message).not.toContain("[ndx-debug:");
    });

    it("is linear on a long run of spaces with no sentinel", async () => {
      const err = new Error(`Invalid JSON in LLM response${" ".repeat(20_000)}[ndx-debug:x`);
      const r = await callWithinBudget<typeof classifyLLMError>(CLASSIFIER, "classifyLLMError", err);
      expect(r.category).toBe("parse");
      expect(r.message).not.toContain("Raw response saved to");
    });
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

  // ── stable error code per category ────────────────────────────────

  it("sets a stable CLI error code matching the category", () => {
    const cases: Array<[Error, string]> = [
      [new Error("401 Unauthorized"), "NDX_CLI_AUTH_FAILED"],
      [new Error("429 Rate limit"), "NDX_CLI_LLM_RATE_LIMITED"],
      [new Error("budget exceeded"), "NDX_CLI_BUDGET_EXCEEDED"],
      [new Error("408 request timeout"), "NDX_CLI_TIMEOUT"],
      [new Error("ETIMEDOUT timed out"), "NDX_CLI_NETWORK_ERROR"],
      [new Error("ENOTFOUND"), "NDX_CLI_NETWORK_ERROR"],
      [new Error("invalid json"), "NDX_CLI_JSON_PARSE_FAILED"],
      [new Error("529 Overloaded"), "NDX_CLI_LLM_SERVER_ERROR"],
      [new Error("something totally unexpected"), "NDX_CLI_GENERIC"],
    ];
    for (const [err, expectedCode] of cases) {
      expect(classifyLLMError(err).code).toBe(expectedCode);
    }
  });

  // ── raw provider detail surfaced ──────────────────────────────────

  it("surfaces Google's RESOURCE_EXHAUSTED reason on a 429", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: "Quota exceeded for quota metric 'Generate requests'.",
        status: "RESOURCE_EXHAUSTED",
      },
    });
    const r = classifyLLMError(
      new Error(`Gemini API error 429: ${body}`),
      "google",
    );
    expect(r.category).toBe("rate-limit");
    expect(r.message).toContain("RESOURCE_EXHAUSTED");
    expect(r.message).toContain("Quota exceeded");
  });

  it("does NOT surface the raw provider payload on auth failure (canonical message only)", () => {
    const body = JSON.stringify({
      error: { message: "Incorrect API key provided", code: "invalid_api_key" },
    });
    const r = classifyLLMError(
      new Error(`OpenAI API error 401: ${body}`),
      "codex",
    );
    expect(r.category).toBe("auth");
    // Primary message is canonical and JSON-free — no raw provider fields.
    expect(r.message).toContain("Authentication failed for Codex");
    expect(r.message).not.toContain("Incorrect API key provided");
    expect(r.message).not.toContain("invalid_api_key");
    expect(r.message).not.toContain("{");
  });

  it("passes a plain (non-JSON) provider message through as detail", () => {
    const r = classifyLLMError(new Error("429 upstream connect error, too busy"));
    expect(r.category).toBe("rate-limit");
    expect(r.message).toContain("upstream connect error");
  });
});

describe("extractProviderDetail", () => {
  it("parses a Google JSON body into '<status>: <message>'", () => {
    const body = JSON.stringify({
      error: { message: "Quota exceeded.", status: "RESOURCE_EXHAUSTED" },
    });
    expect(extractProviderDetail(`Gemini API error 429: ${body}`)).toBe(
      "RESOURCE_EXHAUSTED: Quota exceeded.",
    );
  });

  it("appends quota metric / retry delay from Google details[]", () => {
    const body = JSON.stringify({
      error: {
        message: "Quota exceeded.",
        status: "RESOURCE_EXHAUSTED",
        details: [
          { violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_requests" }] },
          { retryDelay: "37s" },
        ],
      },
    });
    const detail = extractProviderDetail(`Gemini API error 429: ${body}`);
    expect(detail).toContain("generate_requests");
    expect(detail).toContain("retry in 37s");
  });

  it("strips the stream-error prefix too", () => {
    const body = JSON.stringify({ error: { message: "boom", code: "x" } });
    expect(extractProviderDetail(`OpenAI API stream error 500: ${body}`)).toBe("x: boom");
  });

  it("returns a plain body verbatim when it is not JSON", () => {
    expect(extractProviderDetail("Gemini API error 503: service unavailable")).toBe(
      "service unavailable",
    );
  });

  it("collapses whitespace and truncates very long detail", () => {
    const long = "x".repeat(500);
    const out = extractProviderDetail(long);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty string for empty input", () => {
    expect(extractProviderDetail("")).toBe("");
  });
});

describe("isAuthError", () => {
  describe("API auth signatures", () => {
    it.each([
      ["401 Unauthorized", "401"],
      ["Request failed with status 403", "403"],
      ["Invalid API key provided", "invalid api key"],
      ["authentication failed", "authentication failed"],
      ["Authentication error: token invalid", "authentication invalid"],
      ["unauthorized", "bare unauthorized"],
    ])("returns true for '%s' (%s)", (input) => {
      expect(isAuthError(input)).toBe(true);
    });
  });

  describe("CLI session-loss signatures", () => {
    it.each([
      ["Not logged in", "not logged in"],
      ["Please run claude login to authenticate", "please run login"],
      ["Please sign in first", "please sign in"],
      ["Run /login to continue", "/login"],
      ["Your session has expired", "session expired"],
      ["OAuth token has expired", "oauth token expired"],
      ["The access token was revoked", "access token revoked"],
      ["Credentials were rejected", "credentials rejected"],
      ["Authentication required", "authentication required"],
      ["Please re-authenticate and retry", "re-authenticate"],
    ])("returns true for '%s' (%s)", (input) => {
      expect(isAuthError(input)).toBe(true);
    });
  });

  describe("non-auth errors (no false positives)", () => {
    it.each([
      ["token limit exceeded for this project", "budget, not auth"],
      ["response truncated at 4096 tokens", "parse, not auth"],
      ["429 Too Many Requests", "rate-limit"],
      ["ECONNRESET", "network"],
      ["529 Overloaded", "server"],
      ["File not found: foo.ts", "generic"],
      ["", "empty string"],
    ])("returns false for '%s' (%s)", (input) => {
      expect(isAuthError(input)).toBe(false);
    });
  });

  // The gaps in these signatures are bounded (`[^\n]{0,80}?`): the words of
  // one provider sentence sit within a line of each other, never 80 characters
  // apart, so a credential phrase that straddles lines or a long run of other
  // text is not one. The cases pin that reading.
  describe("bounded gaps between the words of a signature", () => {
    it.each([
      ["invalid x-api-key", "hyphenated key header"],
      ["Invalid API key provided", "spaced phrase"],
      ["invalid_api_key", "snake_case code"],
      ["invalid: the configured API key was rejected", "words between invalid and key"],
      ["authentication_error", "snake_case type"],
      ["Authentication failed", "two words"],
      ["Authentication error: token invalid", "error then invalid"],
      ["Authentication to the upstream service is required", "required at a distance"],
    ])("returns true for '%s' (%s)", (input) => {
      expect(isAuthError(input)).toBe(true);
    });

    it.each([
      [`invalid ${"x".repeat(100)} api key`, "100 characters between invalid and api"],
      ["invalid\napi key", "newline between invalid and api"],
      [`authentication ${"x".repeat(100)} failed`, "100 characters between authentication and failed"],
    ])("returns false for '%s' (%s)", (input) => {
      expect(isAuthError(input)).toBe(false);
    });
  });

  // Provider bodies reach the classifier whole (`response.text()` interpolated
  // into Error.message, or a CLI's stderr accumulated unbounded), so each
  // signature must stay linear in the message. The calls run under lang-kit's
  // callWithinBudget: a regressed pattern blocks the thread it matches on,
  // where vitest's per-test timeout never fires, and the helper fails the
  // test by name instead. Each expected value is what the signature gave
  // before the gaps were bounded.
  describe("on pathological input", { timeout: BOUNDED_TEST_TIMEOUT_MS }, () => {
    it("is linear on 'invalid api ' repeated with no 'key'", async () => {
      const text = "invalid api ".repeat(2000);
      await expect(callWithinBudget<typeof isAuthError>(CLASSIFIER, "isAuthError", text)).resolves.toBe(false);
    });

    it("is linear on 'authentication' repeated with no outcome word", async () => {
      const text = "authentication".repeat(2000);
      await expect(callWithinBudget<typeof isAuthError>(CLASSIFIER, "isAuthError", text)).resolves.toBe(false);
    });

    it("is linear on 'key' repeated with no 'expired' or 'invalid'", async () => {
      const text = "key".repeat(10000);
      await expect(callWithinBudget<typeof isAuthError>(CLASSIFIER, "isAuthError", text)).resolves.toBe(false);
    });

    it("still finds a signature at the head of a long body", async () => {
      const text = `401 Unauthorized: ${"x".repeat(100_000)}`;
      await expect(callWithinBudget<typeof isAuthError>(CLASSIFIER, "isAuthError", text)).resolves.toBe(true);
    });
  });
});
describe("parseAuthPayload", () => {
  // ── detection ─────────────────────────────────────────────────────

  it("detects bare 401 status code", () => {
    const r = parseAuthPayload("401 Unauthorized", "claude");
    expect(r).not.toBeNull();
    expect(r?.httpStatus).toBe(401);
  });

  it("detects 403 status code", () => {
    const r = parseAuthPayload("403 Forbidden", "claude");
    expect(r).not.toBeNull();
    expect(r?.httpStatus).toBe(403);
  });

  it("detects invalid_api_key without status code", () => {
    const r = parseAuthPayload("invalid_api_key provided", "claude");
    expect(r).not.toBeNull();
    expect(r?.httpStatus).toBeNull();
    expect(r?.authReason).toMatch(/invalid/i);
  });

  it("detects invalid API key phrase", () => {
    const r = parseAuthPayload("Invalid API key provided", "claude");
    expect(r).not.toBeNull();
    expect(r?.authReason).toMatch(/invalid/i);
  });

  it("detects expired token", () => {
    const r = parseAuthPayload("Your API key has expired", "claude");
    expect(r).not.toBeNull();
    expect(r?.authReason).toContain("expired");
  });

  it("detects expired token variant", () => {
    const r = parseAuthPayload("Token expired — please refresh credentials", "claude");
    expect(r).not.toBeNull();
    expect(r?.authReason).toContain("expired");
  });

  it("detects authentication_error string", () => {
    const r = parseAuthPayload("authentication_error: bad credentials", "claude");
    expect(r).not.toBeNull();
  });

  it("returns null for rate-limit errors", () => {
    expect(parseAuthPayload("429 Too Many Requests", "claude")).toBeNull();
  });

  it("returns null for network errors", () => {
    expect(parseAuthPayload("ENOTFOUND api.anthropic.com", "claude")).toBeNull();
  });

  it("returns null for budget errors", () => {
    expect(parseAuthPayload("budget exceeded", "claude")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseAuthPayload("", "claude")).toBeNull();
  });

  // ── reason extraction from JSON payloads ──────────────────────────

  it("extracts message from Google JSON error body", () => {
    const body = JSON.stringify({
      error: { code: 401, message: "API key not valid. Please pass a valid API key.", status: "UNAUTHENTICATED" },
    });
    const r = parseAuthPayload(`Gemini API error 401: ${body}`, "google");
    expect(r).not.toBeNull();
    expect(r?.httpStatus).toBe(401);
    expect(r?.authReason).toContain("API key not valid");
  });

  it("extracts message from Anthropic authentication_error payload", () => {
    const body = JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    });
    const r = parseAuthPayload(`OpenAI API error 401: ${body}`, "codex");
    expect(r).not.toBeNull();
    expect(r?.authReason).toContain("invalid x-api-key");
  });

  it("extracts message from embedded JSON (no vendor prefix)", () => {
    const body = JSON.stringify({
      error: { type: "authentication_error", message: "invalid x-api-key" },
    });
    const r = parseAuthPayload(`There was an error: ${body}`, "claude");
    expect(r).not.toBeNull();
    expect(r?.authReason).toContain("invalid x-api-key");
  });

  // The detection patterns read a bounded window of the message; the JSON
  // extractors read all of it. A provider body puts its status and error type
  // at the head and may carry kilobytes of detail behind them, and the
  // error.message inside that detail is still the reason worth showing.
  it("extracts error.message from a JSON body longer than the detection window", () => {
    const body = JSON.stringify({
      error: {
        type: "authentication_error",
        message: "invalid x-api-key",
        request_log: "x".repeat(10_000),
      },
    });
    const r = parseAuthPayload(`OpenAI API error 401: ${body}`, "codex");
    expect(r).not.toBeNull();
    expect(r?.httpStatus).toBe(401);
    expect(r?.authReason).toBe("invalid x-api-key");
  });

  // ── bounded gaps ──────────────────────────────────────────────────

  // A plain-text message is its own reason (extractProviderDetail echoes a
  // body with no JSON in it), so the assertion is on the word that detected it.
  it.each([
    ["invalid x-api-key", /invalid/i],
    ["Invalid API key provided", /invalid/i],
    ["invalid_api_key", /invalid/i],
    ["Your API key has expired", /expired/i],
    ["Token expired — please refresh credentials", /expired/i],
    ["The expired key was rejected", /expired/i],
    ["Unauthorized request", /unauthorized/i],
    ["unauthorized: access denied", /unauthorized/i],
    ["authentication_error: bad credentials", /authentication/i],
    ["Authentication failed", /authentication/i],
  ])("detects '%s' (reason matches %s)", (input, reason) => {
    const r = parseAuthPayload(input, "claude");
    expect(r).not.toBeNull();
    expect(r?.authReason).toMatch(reason);
  });

  it.each([
    [`invalid ${"x".repeat(100)} api key`, "100 characters between invalid and api"],
    [`expired ${"x".repeat(100)} token`, "100 characters between expired and token"],
    [`unauthorized ${"x".repeat(100)} request`, "100 characters between unauthorized and request"],
  ])("returns null for '%s' (%s)", (input) => {
    expect(parseAuthPayload(input, "claude")).toBeNull();
  });

  // ── linearity (see the isAuthError block for why these run in a worker) ──

  describe("on pathological input", { timeout: BOUNDED_TEST_TIMEOUT_MS }, () => {
    it("is linear on 'invalid api ' repeated with no 'key'", async () => {
      const text = "invalid api ".repeat(2000);
      await expect(callWithinBudget<typeof parseAuthPayload>(CLASSIFIER, "parseAuthPayload", text, "claude")).resolves.toBeNull();
    });

    it("is linear on 'authentication' repeated with no outcome word", async () => {
      const text = "authentication".repeat(2000);
      await expect(callWithinBudget<typeof parseAuthPayload>(CLASSIFIER, "parseAuthPayload", text, "claude")).resolves.toBeNull();
    });

    it("is linear on 'key' repeated with no 'expired'", async () => {
      const text = "key".repeat(10000);
      await expect(callWithinBudget<typeof parseAuthPayload>(CLASSIFIER, "parseAuthPayload", text, "claude")).resolves.toBeNull();
    });

    it("is linear on 'unauthorized ' repeated with no object word", async () => {
      const text = "unauthorized ".repeat(2000);
      await expect(callWithinBudget<typeof parseAuthPayload>(CLASSIFIER, "parseAuthPayload", text, "claude")).resolves.toBeNull();
    });
  });
});

describe("classifyAuthError", () => {
  // ── returns AuthFailureError ──────────────────────────────────────

  it("returns AuthFailureError for 401", () => {
    const r = classifyAuthError(new Error("401 Unauthorized"), "claude");
    expect(r).toBeInstanceOf(AuthFailureError);
    expect(r?.provider).toBe("claude");
    expect(r?.httpStatus).toBe(401);
    expect(r?.message).toContain("Authentication failed");
    expect(r?.retryable).toBe(false);
  });

  it("is also instanceof ClaudeClientError (backward compat)", () => {
    const r = classifyAuthError(new Error("401 Unauthorized"), "claude");
    expect(r).toBeInstanceOf(ClaudeClientError);
    expect(r?.reason).toBe("auth");
  });

  it("carries provider name for claude", () => {
    const r = classifyAuthError(new Error("Invalid API key"), "claude");
    expect(r?.provider).toBe("claude");
  });

  it("carries provider name for google", () => {
    const body = JSON.stringify({ error: { code: 401, message: "API key not valid.", status: "UNAUTHENTICATED" } });
    const r = classifyAuthError(new Error(`Gemini API error 401: ${body}`), "google");
    expect(r?.provider).toBe("google");
    expect(r?.httpStatus).toBe(401);
  });

  it("carries provider name for codex", () => {
    const r = classifyAuthError(new Error("401 Unauthorized"), "codex");
    expect(r?.provider).toBe("codex");
  });

  it("has null httpStatus when no status code in message", () => {
    const r = classifyAuthError(new Error("Invalid API key provided"), "claude");
    expect(r?.httpStatus).toBeNull();
  });

  it("returns AuthFailureError for expired-token scenario", () => {
    const r = classifyAuthError(new Error("Your API key has expired"), "claude");
    expect(r).toBeInstanceOf(AuthFailureError);
    expect(r?.authReason).toContain("expired");
  });

  it("returns AuthFailureError for invalid-key scenario with Claude JSON payload", () => {
    const body = JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    });
    const r = classifyAuthError(new Error(`401 ${body}`), "claude");
    expect(r).toBeInstanceOf(AuthFailureError);
    expect(r?.authReason).toContain("invalid x-api-key");
    // No raw JSON in the user-facing message
    expect(r?.message).not.toContain("{");
  });

  it("returns AuthFailureError for Google 401 — message is clean (no JSON blob)", () => {
    const body = JSON.stringify({ error: { code: 401, message: "API key not valid.", status: "UNAUTHENTICATED" } });
    const r = classifyAuthError(new Error(`Gemini API error 401: ${body}`), "google");
    expect(r).toBeInstanceOf(AuthFailureError);
    expect(r?.message).toContain("Authentication failed for Google");
    expect(r?.message).toContain("Invalid or expired credentials");
    expect(r?.message).not.toContain("{");  // no raw JSON blob
  });

  // ── returns null for non-auth errors ─────────────────────────────

  it("returns null for rate-limit errors (no regression)", () => {
    const r = classifyAuthError(new Error("429 Too Many Requests"), "claude");
    expect(r).toBeNull();
  });

  it("returns null for budget errors (no regression)", () => {
    const r = classifyAuthError(new Error("budget exceeded"), "claude");
    expect(r).toBeNull();
  });

  it("returns null for network errors", () => {
    const r = classifyAuthError(new Error("ENOTFOUND api.anthropic.com"), "claude");
    expect(r).toBeNull();
  });

  it("returns null for generic unknown errors", () => {
    const r = classifyAuthError(new Error("something unexpected"), "claude");
    expect(r).toBeNull();
  });
});
