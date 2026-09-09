/**
 * Diagnostics for the Ask panel's degraded modes.
 *
 * The property under test throughout is that no mode collapses into a generic
 * failure: each names itself, each says what to do, and `retryable` is only
 * true where asking again could actually work.
 *
 * @see packages/web/src/server/sourcevision-ask-diagnostics.ts
 */

import { describe, it, expect } from "vitest";
import { authFailureGuidance, VERIFY_CREDENTIALS_STEP } from "@n-dx/llm-client";
import {
  noAnalysisFailure,
  askFailureForReason,
  isAskFailure,
} from "../../../src/server/sourcevision-ask-diagnostics.js";

const REASONS = ["auth", "rate-limit", "timeout", "not-found", "cli", "unknown"] as const;

describe("noAnalysisFailure", () => {
  it("says there is nothing to answer from and how to fix it", () => {
    const failure = noAnalysisFailure();

    expect(failure.code).toBe("no_analysis");
    expect(failure.summary).toMatch(/not been analyzed/i);
    expect(failure.remediation.join(" ")).toContain("analyze");
  });

  it("names the project's own command", () => {
    // A project that renamed the CLI should not be told to run `ndx`.
    expect(noAnalysisFailure("mydx").remediation.join(" ")).toContain("mydx analyze");
  });

  it("is not retryable — asking again changes nothing until analysis runs", () => {
    expect(noAnalysisFailure().retryable).toBe(false);
  });
});

describe("askFailureForReason", () => {
  it("takes auth wording from llm-client rather than inventing its own", () => {
    const failure = askFailureForReason("auth", "claude", "401 unauthorized");
    const canonical = authFailureGuidance("claude");

    // The whole product states this one the same way; the dashboard does not
    // get its own dialect.
    expect(failure.summary).toBe(canonical.headline);
    expect(failure.remediation).toEqual(canonical.remediation);
    expect(failure.remediation.at(-1)).toBe(VERIFY_CREDENTIALS_STEP);
  });

  it("gives each vendor its own auth advice", () => {
    // `claude logout && claude login` is wrong advice for a Google API key.
    const claude = askFailureForReason("auth", "claude", "");
    const google = askFailureForReason("auth", "google", "");

    expect(claude.remediation.join(" ")).toContain("claude login");
    expect(google.remediation.join(" ")).toContain("api_key");
    expect(claude.summary).not.toBe(google.summary);
  });

  it("keeps the provider's raw text out of the auth message", () => {
    // Provider payloads carry noise and sometimes secrets; the canonical
    // guidance is more useful than the 401 body.
    const failure = askFailureForReason("auth", "claude", '{"error":{"type":"authentication_error"}}');

    expect(JSON.stringify(failure)).not.toContain("authentication_error");
  });

  it("names a rate limit as itself and offers a retry", () => {
    const failure = askFailureForReason("rate-limit", "claude", "retry after 30s");

    expect(failure.code).toBe("rate_limit");
    expect(failure.summary).toMatch(/rate limit/i);
    expect(failure.remediation.join(" ")).toContain("retry after 30s");
    expect(failure.retryable).toBe(true);
  });

  it("names a timeout as itself and offers a retry", () => {
    const failure = askFailureForReason("timeout", "claude", "timed out after 120000ms");

    expect(failure.code).toBe("timeout");
    expect(failure.summary).toMatch(/did not answer in time/i);
    expect(failure.retryable).toBe(true);
  });

  it("names a missing CLI and does not offer a pointless retry", () => {
    const failure = askFailureForReason("not-found", "codex", "spawn codex ENOENT");

    expect(failure.code).toBe("cli_not_found");
    expect(failure.summary).toContain("codex");
    expect(failure.remediation.join(" ")).toContain("llm.codex.cli_path");
    // Retrying cannot install a binary.
    expect(failure.retryable).toBe(false);
  });

  it("reports an unclassified provider failure with what the provider said", () => {
    const failure = askFailureForReason("unknown", "claude", "upstream connect error");

    expect(failure.code).toBe("provider_error");
    expect(failure.remediation.join(" ")).toContain("upstream connect error");
    expect(failure.retryable).toBe(true);
  });

  it("still produces usable remediation when the provider said nothing", () => {
    const failure = askFailureForReason("cli", "claude", "");

    expect(failure.remediation.length).toBeGreaterThan(0);
    expect(failure.remediation.every((line) => line.trim().length > 0)).toBe(true);
  });

  it("never returns a bare generic failure for any reason it can be given", () => {
    // The outcome this module exists to prevent, asserted across every reason
    // the route can classify plus one it cannot.
    for (const reason of REASONS) {
      const failure = askFailureForReason(reason, "claude", "detail");

      expect(isAskFailure(failure), reason).toBe(true);
      expect(failure.summary, reason).not.toMatch(/^(request failed|error|failed)\.?$/i);
      expect(failure.summary.length, reason).toBeGreaterThan(15);
      expect(failure.remediation.length, reason).toBeGreaterThan(0);
    }
  });

  it("distinguishes every reason it is given", () => {
    const codes = REASONS.map((r) => askFailureForReason(r, "claude", "d").code);

    // `cli` and `unknown` share provider_error by design; the rest are distinct.
    expect(new Set(codes).size).toBe(REASONS.length - 1);
  });
});

describe("isAskFailure", () => {
  const valid = { code: "timeout", summary: "The model did not answer in time.", remediation: ["Ask again."], retryable: true };

  it("accepts a well-formed failure", () => {
    expect(isAskFailure(valid)).toBe(true);
  });

  it("rejects the shapes that would render as nothing", () => {
    expect(isAskFailure(null)).toBe(false);
    expect(isAskFailure({ ...valid, summary: "  " })).toBe(false);
    expect(isAskFailure({ ...valid, remediation: "Ask again." })).toBe(false);
    expect(isAskFailure({ ...valid, remediation: [""] })).toBe(false);
    expect(isAskFailure({ ...valid, retryable: "yes" })).toBe(false);
  });
});
