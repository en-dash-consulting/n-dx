import { describe, it, expect } from "vitest";
import {
  READ_ONLY_REFUSAL_REASON,
  countFileEditCalls,
  describeReadOnlyRefusal,
  isReadOnlyRefusal,
} from "../../../src/agent/lifecycle/read-only-refusal.js";

describe("isReadOnlyRefusal", () => {
  const READS = ["Read", "Grep", "Bash"];

  it("is a refusal when a fork ends with no diff and no edit calls", () => {
    expect(isReadOnlyRefusal({ forked: true, noChanges: true, toolNames: READS })).toBe(true);
  });

  it("is not a refusal when the attempt called an edit tool", () => {
    for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch", "write_file"]) {
      expect(isReadOnlyRefusal({ forked: true, noChanges: true, toolNames: [...READS, tool] })).toBe(false);
    }
  });

  it("is not a refusal for a cold attempt", () => {
    expect(isReadOnlyRefusal({ forked: false, noChanges: true, toolNames: READS })).toBe(false);
  });

  it("is not a refusal when the rejection was not for missing changes", () => {
    expect(isReadOnlyRefusal({ forked: true, noChanges: false, toolNames: READS })).toBe(false);
  });

  it("is not a refusal when earlier attempts already committed the task's files", () => {
    expect(
      isReadOnlyRefusal({ forked: true, noChanges: true, toolNames: READS, priorAttemptWorkOnBranch: true }),
    ).toBe(false);
  });

  it("is still a refusal when the prior-work flag is false", () => {
    expect(
      isReadOnlyRefusal({ forked: true, noChanges: true, toolNames: READS, priorAttemptWorkOnBranch: false }),
    ).toBe(true);
  });

  it("ignores the agent's wording", () => {
    // Structural only: no summary input exists to sway the decision.
    expect(countFileEditCalls(["Read", "Edit", "edit"])).toBe(2);
  });
});

describe("describeReadOnlyRefusal", () => {
  it("uses the plain reason when the reply names no read-only instruction", () => {
    expect(describeReadOnlyRefusal("I looked around.")).toBe(READ_ONLY_REFUSAL_REASON);
    expect(describeReadOnlyRefusal(undefined)).toBe(READ_ONLY_REFUSAL_REASON);
  });

  it("quotes the sentence that names the instruction", () => {
    const reason = describeReadOnlyRefusal(
      "I reviewed the code. This session's instructions say not to edit anything, so I stopped.",
    );
    expect(reason).toBe(
      `${READ_ONLY_REFUSAL_REASON}: "This session's instructions say not to edit anything, so I stopped."`,
    );
  });
});
