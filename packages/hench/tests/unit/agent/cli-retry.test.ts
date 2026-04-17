import { describe, it, expect } from "vitest";
import {
  isTransientError,
  computeDelay,
  buildRetryNotice,
} from "../../../src/agent/lifecycle/cli-loop.js";

describe("isTransientError", () => {
  describe("transient HTTP status codes", () => {
    it.each([
      ["Internal Server Error 500", "500"],
      ["Bad Gateway 502", "502"],
      ["Service Unavailable 503", "503"],
      ["API overloaded 529", "529"],
      ["Rate limited 429", "429"],
    ])("returns true for '%s' (%s)", (input) => {
      expect(isTransientError(input)).toBe(true);
    });

    it("matches status code in multi-line error output", () => {
      const multiLine = "HTTP/1.1 502 Bad Gateway\nConnection closed";
      expect(isTransientError(multiLine)).toBe(true);
    });

    it("matches status code surrounded by other text", () => {
      expect(isTransientError("Error: server returned 503, retrying")).toBe(true);
    });
  });

  describe("transient network errors", () => {
    it.each([
      ["The API is overloaded right now", "overloaded"],
      ["connect ETIMEDOUT 1.2.3.4:443", "ETIMEDOUT"],
      ["read ECONNRESET", "ECONNRESET"],
      ["connect ECONNREFUSED 127.0.0.1:3000", "ECONNREFUSED"],
      ["socket hang up", "socket hang up"],
      ["Network error occurred", "network error"],
    ])("returns true for '%s' (%s)", (input) => {
      expect(isTransientError(input)).toBe(true);
    });

    it("matches overloaded case-insensitively", () => {
      expect(isTransientError("API OVERLOADED")).toBe(true);
      expect(isTransientError("Overloaded")).toBe(true);
    });

    it("matches socket hang up case-insensitively", () => {
      expect(isTransientError("Socket Hang Up")).toBe(true);
    });

    it("matches network error case-insensitively", () => {
      expect(isTransientError("NETWORK ERROR")).toBe(true);
    });
  });

  describe("vendor CLI non-zero exits", () => {
    it("returns true for 'codex exited with code 1'", () => {
      expect(isTransientError("codex exited with code 1")).toBe(true);
    });

    it("returns true for 'codex exited with code 137' (OOM kill)", () => {
      expect(isTransientError("codex exited with code 137")).toBe(true);
    });

    it("returns true for 'claude exited with code 1'", () => {
      expect(isTransientError("claude exited with code 1")).toBe(true);
    });

    it("returns true for 'claude exited with code 143' (SIGTERM)", () => {
      expect(isTransientError("claude exited with code 143")).toBe(true);
    });

    it("matches the pattern case-insensitively", () => {
      expect(isTransientError("Codex Exited With Code 2")).toBe(true);
      expect(isTransientError("Claude Exited With Code 2")).toBe(true);
    });

    it("does not match unrelated 'exited with code' text", () => {
      // Avoids false positives for arbitrary processes
      expect(isTransientError("python exited with code 1")).toBe(false);
      expect(isTransientError("node exited with code 1")).toBe(false);
    });
  });

  describe("non-transient errors", () => {
    it.each([
      ["Invalid API key", "auth error"],
      ["Permission denied", "permission error"],
      ["File not found: foo.ts", "generic failure"],
      ["SyntaxError: Unexpected token", "syntax error"],
      ["Claude CLI not found", "missing binary"],
    ])("returns false for '%s' (%s)", (input) => {
      expect(isTransientError(input)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isTransientError("")).toBe(false);
    });

    it("returns false for generic error messages", () => {
      expect(isTransientError("Something went wrong")).toBe(false);
    });

    it("does not match status codes embedded in non-error contexts", () => {
      // Port numbers and years should not trigger false positives
      // because \b word boundary prevents matching within longer numbers
      expect(isTransientError("listening on port 5000")).toBe(false);
      expect(isTransientError("file has 5029 lines")).toBe(false);
    });

    it("does not match partial keyword matches", () => {
      expect(isTransientError("TIMEOUT_EXCEEDED")).toBe(false);
      expect(isTransientError("CONNECTION_RESET_BY_PEER")).toBe(false);
    });
  });

  describe("combined error messages", () => {
    it("returns true when transient error appears among other text", () => {
      const combined =
        "Error during API call: connect ETIMEDOUT 104.18.6.192:443 at TCPConnectWrap";
      expect(isTransientError(combined)).toBe(true);
    });

    it("returns true for rate limit responses with JSON body", () => {
      const rateLimitBody =
        '{"error":{"type":"rate_limit_error","message":"Rate limited"},"status":429}';
      expect(isTransientError(rateLimitBody)).toBe(true);
    });

    it("returns true for overloaded responses with JSON body", () => {
      const overloadBody =
        '{"error":{"type":"overloaded_error","message":"API is overloaded"}}';
      expect(isTransientError(overloadBody)).toBe(true);
    });
  });
});

describe("computeDelay", () => {
  describe("exponential backoff", () => {
    it("returns baseMs for attempt 0", () => {
      expect(computeDelay(0, 2000, 30000)).toBe(2000);
    });

    it("doubles for each attempt", () => {
      expect(computeDelay(1, 2000, 30000)).toBe(4000);
      expect(computeDelay(2, 2000, 30000)).toBe(8000);
      expect(computeDelay(3, 2000, 30000)).toBe(16000);
    });

    it("caps at maxMs", () => {
      expect(computeDelay(4, 2000, 30000)).toBe(30000);
      expect(computeDelay(10, 2000, 30000)).toBe(30000);
    });
  });

  describe("edge cases", () => {
    it("handles baseMs of 1ms", () => {
      expect(computeDelay(0, 1, 1000)).toBe(1);
      expect(computeDelay(1, 1, 1000)).toBe(2);
      expect(computeDelay(10, 1, 1000)).toBe(1000);
    });

    it("returns maxMs when baseMs exceeds maxMs", () => {
      expect(computeDelay(0, 50000, 30000)).toBe(30000);
    });

    it("handles maxMs equal to baseMs", () => {
      expect(computeDelay(0, 5000, 5000)).toBe(5000);
      expect(computeDelay(3, 5000, 5000)).toBe(5000);
    });

    it("handles very large attempt numbers without overflow issues", () => {
      // Math.pow(2, 100) is ~1.27e30, but Math.min caps it
      const result = computeDelay(100, 2000, 30000);
      expect(result).toBe(30000);
    });

    it("returns correct delay with different base values", () => {
      expect(computeDelay(0, 1000, 60000)).toBe(1000);
      expect(computeDelay(1, 1000, 60000)).toBe(2000);
      expect(computeDelay(2, 1000, 60000)).toBe(4000);
      expect(computeDelay(3, 1000, 60000)).toBe(8000);
      expect(computeDelay(4, 1000, 60000)).toBe(16000);
      expect(computeDelay(5, 1000, 60000)).toBe(32000);
      expect(computeDelay(6, 1000, 60000)).toBe(60000);
    });
  });
});

describe("buildRetryNotice", () => {
  describe("message format", () => {
    it("wraps message in horizontal rule delimiters", () => {
      const notice = buildRetryNotice(0, 3, 5);
      expect(notice).toMatch(/^[\s\S]*---[\s\S]*---$/);
    });

    it("includes RETRY NOTICE label", () => {
      const notice = buildRetryNotice(0, 3, 5);
      expect(notice).toContain("RETRY NOTICE");
    });

    it("mentions prior attempt still exists on disk", () => {
      const notice = buildRetryNotice(0, 3, 5);
      expect(notice).toContain("Files written to disk by the prior attempt still exist");
    });
  });

  describe("attempt numbering", () => {
    it("shows 1-indexed attempt for first retry (attempt 0)", () => {
      const notice = buildRetryNotice(0, 3, 10);
      expect(notice).toContain("attempt 1/4");
    });

    it("shows correct attempt for second retry (attempt 1)", () => {
      const notice = buildRetryNotice(1, 3, 10);
      expect(notice).toContain("attempt 2/4");
    });

    it("shows correct attempt for last retry", () => {
      const notice = buildRetryNotice(3, 3, 10);
      expect(notice).toContain("attempt 4/4");
    });

    it("formats attempt fraction as (attempt+1)/(maxRetries+1)", () => {
      const notice = buildRetryNotice(2, 5, 10);
      expect(notice).toContain("attempt 3/6");
    });
  });

  describe("prior turn count", () => {
    it("includes prior turn count", () => {
      const notice = buildRetryNotice(0, 3, 27);
      expect(notice).toContain("27 turn(s)");
    });

    it("handles zero prior turns", () => {
      const notice = buildRetryNotice(0, 3, 0);
      expect(notice).toContain("0 turn(s)");
    });

    it("handles large turn counts", () => {
      const notice = buildRetryNotice(0, 3, 150);
      expect(notice).toContain("150 turn(s)");
    });
  });

  describe("instructions", () => {
    it("instructs agent to check disk state", () => {
      const notice = buildRetryNotice(0, 3, 5);
      expect(notice).toContain("Check the current state of files");
    });

    it("mentions transient error as cause", () => {
      const notice = buildRetryNotice(0, 3, 5);
      expect(notice).toContain("transient error");
    });
  });
});
