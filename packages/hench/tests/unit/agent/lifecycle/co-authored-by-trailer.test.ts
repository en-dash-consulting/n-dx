/**
 * Unit tests for the Co-Authored-By trailer builder.
 *
 * The placeholder token `n-dx@endash.us` is intentionally literal in
 * the source — the n-dx publishing pipeline substitutes it at publish time.
 * These tests pin the exact token so any accidental drift (e.g. a typo or an
 * early substitution) turns into a failing test rather than a silent
 * regression.
 */

import { describe, it, expect } from "vitest";
import { buildCoAuthoredByTrailerLine } from "../../../../src/agent/lifecycle/shared.js";

describe("buildCoAuthoredByTrailerLine", () => {
  it("returns the exact Co-Authored-By trailer with n-dx@endash.us token", () => {
    expect(buildCoAuthoredByTrailerLine()).toBe(
      "Co-Authored-By: En Dash's n-dx <n-dx@endash.us>",
    );
  });

  it("contains n-dx@endash.us token — regression guard against token drift", () => {
    // This assertion exists specifically to catch refactors that silently
    // alter or pre-substitute the placeholder before publish time.
    const trailer = buildCoAuthoredByTrailerLine();
    expect(trailer).toContain("n-dx@endash.us");
  });

  it("follows standard git Co-Authored-By format (Name <email>)", () => {
    const trailer = buildCoAuthoredByTrailerLine();
    expect(trailer).toMatch(/^Co-Authored-By: .+ <.+>$/);
  });

  it("uses 'ndx' as the co-author name", () => {
    const trailer = buildCoAuthoredByTrailerLine();
    expect(trailer).toContain("Co-Authored-By: En Dash's n-dx ");
  });
});
