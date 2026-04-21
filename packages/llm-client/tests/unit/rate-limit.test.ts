/**
 * Unit tests for rate-limit detection and retry utilities.
 *
 * Covers: Retry-After header parsing, countdown formatting,
 * auto-retry threshold logic, SDK error extraction, and timeout
 * classification.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseRetryAfterHeader,
  formatRetryCountdown,
  shouldAutoRetry,
  extractRetryAfterMs,
  classifyTimeout,
  DEFAULT_AUTO_RETRY_THRESHOLD_MS,
} from "../../src/rate-limit.js";
import { ClaudeClientError } from "../../src/types.js";

// ── parseRetryAfterHeader ───────────────────────────────────────────

describe("parseRetryAfterHeader", () => {
  it("parses integer seconds", () => {
    expect(parseRetryAfterHeader("47")).toBe(47_000);
  });

  it("parses zero seconds", () => {
    expect(parseRetryAfterHeader("0")).toBe(0);
  });

  it("rounds fractional seconds up to whole milliseconds", () => {
    // "1.5" → Number("1.5") = 1.5, ceil(1.5) = 2, * 1000 = 2000
    expect(parseRetryAfterHeader("1.5")).toBe(2000);
  });

  it("parses HTTP-date in the future", () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const ms = parseRetryAfterHeader(future);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(31_000);
  });

  it("returns undefined for HTTP-date in the past", () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    expect(parseRetryAfterHeader(past)).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(parseRetryAfterHeader(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(parseRetryAfterHeader(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseRetryAfterHeader("")).toBeUndefined();
  });

  it("returns undefined for non-numeric, non-date string", () => {
    expect(parseRetryAfterHeader("not-a-number")).toBeUndefined();
  });

  it("returns undefined for negative seconds", () => {
    // -5 is finite and >= 0 is false → tries date parse, which gives NaN
    expect(parseRetryAfterHeader("-5")).toBeUndefined();
  });
});

// ── formatRetryCountdown ────────────────────────────────────────────

describe("formatRetryCountdown", () => {
  it("formats seconds below 60", () => {
    expect(formatRetryCountdown(47)).toBe("47s");
  });

  it("formats zero seconds", () => {
    expect(formatRetryCountdown(0)).toBe("0s");
  });

  it("formats exactly 60 seconds as 1m", () => {
    expect(formatRetryCountdown(60)).toBe("1m");
  });

  it("formats minutes and seconds", () => {
    expect(formatRetryCountdown(150)).toBe("2m 30s");
  });

  it("clamps negative values to 0s", () => {
    expect(formatRetryCountdown(-10)).toBe("0s");
  });

  it("rounds to nearest second", () => {
    expect(formatRetryCountdown(47.7)).toBe("48s");
  });

  it("formats large values", () => {
    expect(formatRetryCountdown(3600)).toBe("60m");
  });
});

// ── shouldAutoRetry ─────────────────────────────────────────────────

describe("shouldAutoRetry", () => {
  it("returns true when delay is within default threshold", () => {
    expect(shouldAutoRetry(30_000)).toBe(true);
  });

  it("returns true at the exact threshold boundary", () => {
    expect(shouldAutoRetry(DEFAULT_AUTO_RETRY_THRESHOLD_MS)).toBe(true);
  });

  it("returns false when delay exceeds threshold", () => {
    expect(shouldAutoRetry(61_000)).toBe(false);
  });

  it("returns false for zero delay", () => {
    expect(shouldAutoRetry(0)).toBe(false);
  });

  it("returns false for negative delay", () => {
    expect(shouldAutoRetry(-1000)).toBe(false);
  });

  it("respects custom threshold", () => {
    expect(shouldAutoRetry(5000, 3000)).toBe(false);
    expect(shouldAutoRetry(2000, 3000)).toBe(true);
  });
});

// ── extractRetryAfterMs ─────────────────────────────────────────────

describe("extractRetryAfterMs", () => {
  it("extracts from a 429 error with headers", () => {
    const err = {
      status: 429,
      headers: { get: (name: string) => (name === "retry-after" ? "30" : null) },
      message: "rate limited",
    };
    expect(extractRetryAfterMs(err)).toBe(30_000);
  });

  it("returns undefined for non-429 status", () => {
    const err = {
      status: 500,
      headers: { get: () => "30" },
      message: "server error",
    };
    expect(extractRetryAfterMs(err)).toBeUndefined();
  });

  it("returns undefined when headers lack retry-after", () => {
    const err = {
      status: 429,
      headers: { get: () => null },
      message: "rate limited",
    };
    expect(extractRetryAfterMs(err)).toBeUndefined();
  });

  it("returns undefined for null error", () => {
    expect(extractRetryAfterMs(null)).toBeUndefined();
  });

  it("returns undefined for non-object error", () => {
    expect(extractRetryAfterMs("string")).toBeUndefined();
  });

  it("returns undefined when no headers property", () => {
    const err = { status: 429, message: "rate limited" };
    expect(extractRetryAfterMs(err)).toBeUndefined();
  });

  it("returns undefined when headers.get is not a function", () => {
    const err = { status: 429, headers: { "retry-after": "30" }, message: "" };
    expect(extractRetryAfterMs(err)).toBeUndefined();
  });
});

// ── ClaudeClientError retryAfterMs ──────────────────────────────────

describe("ClaudeClientError retryAfterMs", () => {
  it("stores retryAfterMs when positive", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true, 30_000);
    expect(err.retryAfterMs).toBe(30_000);
  });

  it("omits retryAfterMs when zero", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true, 0);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("omits retryAfterMs when not provided", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("omits retryAfterMs when negative", () => {
    const err = new ClaudeClientError("rate limited", "rate-limit", true, -100);
    expect(err.retryAfterMs).toBeUndefined();
  });
});

// ── classifyTimeout ─────────────────────────────────────────────────

describe("classifyTimeout", () => {
  it("classifies ETIMEDOUT as network", () => {
    expect(classifyTimeout(new Error("connect ETIMEDOUT 1.2.3.4:443"))).toBe("network");
  });

  it("classifies ECONNRESET as network", () => {
    expect(classifyTimeout(new Error("read ECONNRESET"))).toBe("network");
  });

  it("classifies ECONNREFUSED as network", () => {
    expect(classifyTimeout(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe("network");
  });

  it("classifies socket hang up as network", () => {
    expect(classifyTimeout(new Error("socket hang up"))).toBe("network");
  });

  it("classifies connection timed out as network", () => {
    expect(classifyTimeout(new Error("Connection timed out"))).toBe("network");
  });

  it("classifies ENOTFOUND as network", () => {
    expect(classifyTimeout(new Error("getaddrinfo ENOTFOUND api.anthropic.com"))).toBe("network");
  });

  it("classifies generic timeout as api", () => {
    expect(classifyTimeout(new Error("Request timeout after 300000ms"))).toBe("api");
  });

  it("classifies 408 timeout as api", () => {
    expect(classifyTimeout(new Error("408 Request Timeout"))).toBe("api");
  });

  it("classifies unknown error as api", () => {
    expect(classifyTimeout(new Error("something timed out"))).toBe("api");
  });
});
