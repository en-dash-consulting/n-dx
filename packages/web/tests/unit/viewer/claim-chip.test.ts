import { describe, it, expect } from "vitest";
import { claimChipLabel, claimChipTitle } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type { ClaimEntry } from "../../../src/viewer/hooks/index.js";

/**
 * The PRD tree's claim chip must distinguish a hold left by a finished run
 * from a live run (PR E, audit item 87f0f9dc): "claimed" reads as "someone is
 * on it right now", which for a held claim sends the reader looking for a
 * process that ended hours ago.
 */

function entry(overrides: Partial<ClaimEntry> = {}): ClaimEntry {
  return {
    taskId: "t1",
    taskTitle: "A task",
    worktreeRoot: "/repos/app/.claude/worktrees/feature-x",
    worktree: "feature-x",
    isServedHere: false,
    pid: 4242,
    host: "box",
    claimedAt: "2026-09-22T10:00:00.000Z",
    expiresAt: "2026-09-22T14:00:00.000Z",
    ...overrides,
  };
}

describe("claim chip", () => {
  it("labels a live claim as claimed, with the worktree", () => {
    expect(claimChipLabel(entry())).toBe("claimed · feature-x");
    expect(claimChipTitle(entry(), "ndx")).toContain("Being worked on");
    expect(claimChipTitle(entry(), "ndx")).toContain("/repos/app/.claude/worktrees/feature-x");
  });

  it("labels a held claim as held, and the tooltip says how to free it", () => {
    const held = entry({ reason: "uncommitted-work" });
    expect(claimChipLabel(held)).toBe("held · feature-x");
    // The command carries the project's resolved CLI name (useCliName in the
    // component), never a hardcoded binary.
    const title = claimChipTitle(held, "myapp");
    expect(title).toContain("uncommitted");
    expect(title).toContain("myapp claim release t1");
    expect(title).not.toContain("Being worked on");
    // A held claim does not expire; the tooltip must not quote a lease time.
    expect(title).not.toContain("2026-09-22T14:00");
  });

  it("says here for the served worktree in both states", () => {
    expect(claimChipLabel(entry({ isServedHere: true }))).toBe("claimed · here");
    expect(claimChipLabel(entry({ isServedHere: true, reason: "uncommitted-work" }))).toBe("held · here");
  });
});
