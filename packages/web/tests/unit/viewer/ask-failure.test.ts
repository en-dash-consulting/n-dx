/**
 * How the Ask panel names each way it can be unusable.
 *
 * The invariant these tests exist for is negative: no degraded mode may render
 * as a bare generic error. That cannot be asserted by looking at the three
 * modes that prompted the work — a fourth added later would slip through — so
 * the "no bare generic" check is driven off `ASK_FAILURE_KINDS` and fails when
 * a kind is added without wording.
 */

import { describe, it, expect } from "vitest";
import {
  ASK_FAILURE_KINDS,
  askFailureKindFromStatus,
  describeAskFailure,
  isAskFailureKind,
  type AskFailure,
  type AskFailureKind,
} from "../../../src/viewer/views/ask-failure.js";

/** A failure the endpoint told us nothing about beyond its kind. */
function bare(kind: AskFailureKind, extra: Partial<AskFailure> = {}): AskFailure {
  return { kind, message: null, suggestion: null, remediation: [], retryAfterMs: null, ...extra };
}

/**
 * Wording that names nothing. A card carrying only one of these is the
 * "request failed" dead end this feature exists to prevent.
 */
const GENERIC_PATTERNS = [
  /^the ask request failed/i,
  /^request failed/i,
  /^error$/i,
  /^failed$/i,
  /^unknown error/i,
  // A status code standing in for a reason.
  /^\s*\d{3}\s*$/,
];

describe("describeAskFailure", () => {
  it("gives every known mode a title, a message, and at least one step", () => {
    for (const kind of ASK_FAILURE_KINDS) {
      const presented = describeAskFailure(bare(kind));
      expect(presented.title.trim().length, kind).toBeGreaterThan(0);
      expect(presented.message.trim().length, kind).toBeGreaterThan(0);
      expect(presented.steps.length, kind).toBeGreaterThan(0);
      for (const step of presented.steps) {
        expect(step.trim().length, `${kind} step`).toBeGreaterThan(0);
      }
    }
  });

  it("renders no bare generic error for any mode, with or without a server message", () => {
    for (const kind of ASK_FAILURE_KINDS) {
      for (const failure of [bare(kind), bare(kind, { message: "" }), bare(kind, { message: "   " })]) {
        const presented = describeAskFailure(failure);
        for (const pattern of GENERIC_PATTERNS) {
          expect(presented.title, `${kind} title`).not.toMatch(pattern);
          expect(presented.message, `${kind} message`).not.toMatch(pattern);
        }
      }
    }
  });

  it("names each mode distinctly rather than reusing one heading", () => {
    const titles = ASK_FAILURE_KINDS.map((kind) => describeAskFailure(bare(kind)).title);
    expect(new Set(titles).size).toBe(ASK_FAILURE_KINDS.length);
  });

  // ── The three modes the task names ──────────────────────────────────────

  it("names a missing analysis and offers the analysis run, not a command", () => {
    const presented = describeAskFailure(bare("no_analysis"));
    expect(presented.needsAnalysis).toBe(true);
    expect(presented.title).toMatch(/analysis/i);
    // Retrying the same question against the same absent data is not the fix.
    expect(presented.canRetry).toBe(false);
  });

  it("carries the endpoint's canonical credential steps through untouched", () => {
    // Stands in for authFailureGuidance("claude").remediation, which the route
    // sends verbatim. The panel must render these lines, not rewrite them.
    const remediation = [
      "Re-authenticate: claude logout && claude login",
      "Verify credentials: ndx auth",
    ];
    const presented = describeAskFailure(bare("auth", { remediation }));
    for (const step of remediation) {
      expect(presented.steps).toContain(step);
    }
    // A credential failure is not fixed by asking again.
    expect(presented.canRetry).toBe(false);
  });

  it("offers a retry for the two transient provider failures and not for the third", () => {
    expect(describeAskFailure(bare("timeout")).canRetry).toBe(true);
    expect(describeAskFailure(bare("rate_limit")).canRetry).toBe(true);
    // A provider error is not known to be transient: an offered retry would
    // spend the same tokens on the same fault.
    expect(describeAskFailure(bare("llm_error")).canRetry).toBe(false);
  });

  it("reports timeout, rate limit, and provider error as themselves", () => {
    expect(describeAskFailure(bare("timeout")).title).toMatch(/time/i);
    expect(describeAskFailure(bare("rate_limit")).title).toMatch(/rate limit/i);
    expect(describeAskFailure(bare("llm_error")).title).toMatch(/provider/i);
  });

  it("states the vendor's own retry delay when it named one", () => {
    expect(describeAskFailure(bare("rate_limit", { retryAfterMs: 7_500 })).steps[0])
      .toContain("8-second");
    expect(describeAskFailure(bare("rate_limit", { retryAfterMs: 300_000 })).steps[0])
      .toContain("5-minute");
  });

  it("omits the delay line when the vendor supplied none", () => {
    const presented = describeAskFailure(bare("rate_limit"));
    expect(presented.steps.join(" ")).not.toMatch(/asked for a/);
  });

  // ── Server wording wins, but never on its own ───────────────────────────

  it("prefers the endpoint's message, which carries the provider's detail", () => {
    const presented = describeAskFailure(
      bare("rate_limit", { message: "Rate limit exceeded (RESOURCE_EXHAUSTED: daily quota)" }),
    );
    expect(presented.message).toContain("RESOURCE_EXHAUSTED");
    // The panel's own guidance is still there — the endpoint's suggestion is
    // often written for the CLI and cannot stand in for it.
    expect(presented.steps.length).toBeGreaterThan(0);
  });
});

describe("askFailureKindFromStatus", () => {
  it("recovers the mode our own endpoint encoded in the status", () => {
    expect(askFailureKindFromStatus(400)).toBe("invalid_request");
    expect(askFailureKindFromStatus(401)).toBe("auth");
    expect(askFailureKindFromStatus(404)).toBe("no_analysis");
    expect(askFailureKindFromStatus(429)).toBe("rate_limit");
    expect(askFailureKindFromStatus(504)).toBe("timeout");
  });

  it("lands on a provider error for a status no one documented", () => {
    // A proxy's HTML 502 used to render as "The Ask request failed (502)".
    expect(askFailureKindFromStatus(502)).toBe("llm_error");
    expect(askFailureKindFromStatus(418)).toBe("llm_error");
  });
});

describe("isAskFailureKind", () => {
  it("accepts every kind the endpoint can send and nothing else", () => {
    for (const kind of ASK_FAILURE_KINDS) expect(isAskFailureKind(kind)).toBe(true);
    for (const other of ["", "boom", null, undefined, 429]) {
      expect(isAskFailureKind(other)).toBe(false);
    }
  });
});
