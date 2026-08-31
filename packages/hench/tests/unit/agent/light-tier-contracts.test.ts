/**
 * Output contracts for light-tier calls.
 *
 * Routing a call to the cheapest adequate model is only safe when bad output
 * is *detectable* — otherwise the saving is paid for in silent corruption.
 * The commit-subject call is the hench end of that: it feeds a `git commit -m`
 * directly, so a model that answers with a preamble, a fenced block, or an
 * essay would write that into the repository's history.
 *
 * The contract deliberately falls back rather than throwing. This runs on the
 * pre-run commit gate, where refusing to commit is worse than committing under
 * the generic message.
 */

import { describe, it, expect } from "vitest";
import {
  extractCommitSubject,
  COMMIT_SUBJECT_MAX_LENGTH,
} from "../../../src/agent/lifecycle/commit-subject.js";

describe("extractCommitSubject", () => {
  it("accepts a well-formed conventional-commit subject unchanged", () => {
    expect(extractCommitSubject("fix(hench): stop the gate skipping changed runs")).toBe(
      "fix(hench): stop the gate skipping changed runs",
    );
  });

  it("takes the first meaningful line when the model adds a body", () => {
    expect(extractCommitSubject("feat: add routing\n\nThis also does other things.")).toBe(
      "feat: add routing",
    );
  });

  it("returns undefined for empty or whitespace-only output", () => {
    expect(extractCommitSubject("")).toBeUndefined();
    expect(extractCommitSubject("   \n\t\n  ")).toBeUndefined();
    expect(extractCommitSubject(undefined)).toBeUndefined();
  });

  it("strips a fenced code block rather than committing the backticks", () => {
    expect(extractCommitSubject("```\nfix: repair the thing\n```")).toBe("fix: repair the thing");
    expect(extractCommitSubject("```sh\nfix: repair the thing\n```")).toBe("fix: repair the thing");
  });

  it("strips surrounding quotes and backticks", () => {
    expect(extractCommitSubject('"fix: repair the thing"')).toBe("fix: repair the thing");
    expect(extractCommitSubject("`fix: repair the thing`")).toBe("fix: repair the thing");
    expect(extractCommitSubject("'fix: repair the thing'")).toBe("fix: repair the thing");
  });

  it("skips a conversational preamble and takes the real subject", () => {
    expect(
      extractCommitSubject("Sure! Here's a commit subject:\n\nfix: repair the thing"),
    ).toBe("fix: repair the thing");
    expect(extractCommitSubject("Here is the commit message:\nchore: bump deps")).toBe(
      "chore: bump deps",
    );
  });

  it("returns undefined when every line is preamble", () => {
    // Better the generic fallback than committing "Sure, here you go:".
    expect(extractCommitSubject("Sure! Here's the commit subject:")).toBeUndefined();
  });

  it("enforces the documented subject length bound", () => {
    const long = `feat: ${"x".repeat(200)}`;
    const subject = extractCommitSubject(long);
    expect(subject).toBeDefined();
    expect(subject!.length).toBeLessThanOrEqual(COMMIT_SUBJECT_MAX_LENGTH);
    expect(COMMIT_SUBJECT_MAX_LENGTH).toBe(72);
  });

  it("never returns a multi-line string — it feeds git commit -m", () => {
    for (const raw of [
      "feat: a\nfeat: b",
      "```\nfeat: a\nfeat: b\n```",
      "Here you go:\nfeat: a\n\nbody text",
    ]) {
      const subject = extractCommitSubject(raw);
      if (subject !== undefined) expect(subject).not.toContain("\n");
    }
  });

  it("rejects a markdown bullet or heading masquerading as a subject", () => {
    expect(extractCommitSubject("- fix: repair the thing")).toBe("fix: repair the thing");
    expect(extractCommitSubject("# fix: repair the thing")).toBe("fix: repair the thing");
  });
});
