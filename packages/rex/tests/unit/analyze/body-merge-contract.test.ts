import { describe, it, expect } from "vitest";
import {
  validateMergedDescription,
  MERGED_DESCRIPTION_MAX_LENGTH,
} from "../../../src/analyze/reshape-reason.js";

/**
 * Output contract for the light-tier body-merge call.
 *
 * This was the one light-routed call with no validation at all: whatever the
 * model returned was written verbatim into the surviving PRD item's
 * description. An empty answer, a "Sure, here's the description:" preamble, or
 * a JSON object would all have been persisted as the item's body.
 *
 * Rejection is the right failure mode here rather than repair: `reshape`
 * already treats body merge as best-effort and keeps the item's existing
 * description when it throws, which beats writing a mangled one.
 */
describe("validateMergedDescription", () => {
  it("accepts a plain-text description unchanged", () => {
    const text = "Adds token routing so mechanical calls run on the light tier.";
    expect(validateMergedDescription(text)).toBe(text);
  });

  it("trims surrounding whitespace", () => {
    expect(validateMergedDescription("\n  A merged description.  \n")).toBe(
      "A merged description.",
    );
  });

  it("rejects empty or whitespace-only output", () => {
    expect(() => validateMergedDescription("")).toThrow(/empty/i);
    expect(() => validateMergedDescription("   \n\t ")).toThrow(/empty/i);
  });

  it("strips a fenced block and keeps the prose inside", () => {
    expect(validateMergedDescription("```\nA merged description.\n```")).toBe(
      "A merged description.",
    );
  });

  it("strips a conversational preamble line", () => {
    expect(
      validateMergedDescription("Here is the combined description:\n\nA merged description."),
    ).toBe("A merged description.");
  });

  it("rejects output that is only a preamble", () => {
    expect(() => validateMergedDescription("Sure! Here's the merged description:")).toThrow();
  });

  it("rejects JSON — the prompt asks for plain text, and a shape change means the model ignored it", () => {
    expect(() => validateMergedDescription('{"description": "x"}')).toThrow(/plain text|json/i);
    expect(() => validateMergedDescription('[{"a": 1}]')).toThrow(/plain text|json/i);
  });

  it("rejects an over-length essay rather than truncating mid-sentence", () => {
    // Truncation would persist a description that stops mid-word; keeping the
    // item's existing body is the better outcome.
    const essay = "word ".repeat(MERGED_DESCRIPTION_MAX_LENGTH);
    expect(() => validateMergedDescription(essay)).toThrow(/too long|length/i);
  });

  it("accepts a multi-paragraph description — only preamble lines are dropped", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    expect(validateMergedDescription(text)).toBe(text);
  });

  it("keeps a description that merely mentions the word description", () => {
    const text = "The description field is normalized during import.";
    expect(validateMergedDescription(text)).toBe(text);
  });
});
