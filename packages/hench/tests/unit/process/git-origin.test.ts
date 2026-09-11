import { describe, it, expect } from "vitest";
import {
  captureRunGitOrigin,
  checkRunGitOrigin,
  type GitOriginProbe,
  type RunGitOrigin,
} from "../../../src/process/git-origin.js";

/** Build a probe reporting a fixed checkout state. */
function probeOf(state: {
  worktreeRoot?: string | null;
  branch?: string;
  head?: string;
}): GitOriginProbe {
  return {
    worktreeRoot: () => state.worktreeRoot ?? null,
    branch: () => state.branch,
    head: () => state.head,
  };
}

const ON_BRANCH = probeOf({ worktreeRoot: "/wt/a", branch: "feat/x", head: "a".repeat(40) });

describe("captureRunGitOrigin", () => {
  it("records worktree root, branch and head", () => {
    expect(captureRunGitOrigin("/wt/a", ON_BRANCH)).toEqual({
      worktreeRoot: "/wt/a",
      branch: "feat/x",
      startHead: "a".repeat(40),
    });
  });

  it("records no branch when HEAD is detached", () => {
    const origin = captureRunGitOrigin(
      "/wt/a",
      probeOf({ worktreeRoot: "/wt/a", branch: "HEAD", head: "b".repeat(40) }),
    );
    expect(origin.branch).toBeUndefined();
    expect(origin.startHead).toBe("b".repeat(40));
  });

  it("records nothing outside a git repository", () => {
    expect(captureRunGitOrigin("/tmp/plain", probeOf({}))).toEqual({
      worktreeRoot: undefined,
      branch: undefined,
      startHead: undefined,
    });
  });
});

describe("checkRunGitOrigin", () => {
  it("allows a run that is still on its branch and worktree", () => {
    const origin = captureRunGitOrigin("/wt/a", ON_BRANCH);
    expect(checkRunGitOrigin("/wt/a", origin, ON_BRANCH)).toBeUndefined();
  });

  it("allows a run whose HEAD advanced on the same branch", () => {
    const origin = captureRunGitOrigin("/wt/a", ON_BRANCH);
    const moved = probeOf({ worktreeRoot: "/wt/a", branch: "feat/x", head: "c".repeat(40) });
    expect(checkRunGitOrigin("/wt/a", origin, moved)).toBeUndefined();
  });

  it("refuses when the branch changed, naming both branches", () => {
    const origin = captureRunGitOrigin("/wt/a", ON_BRANCH);
    const moved = probeOf({ worktreeRoot: "/wt/a", branch: "main", head: "c".repeat(40) });
    const reason = checkRunGitOrigin("/wt/a", origin, moved);
    expect(reason).toContain("feat/x");
    expect(reason).toContain("main");
  });

  it("refuses when HEAD became detached mid-run", () => {
    const origin = captureRunGitOrigin("/wt/a", ON_BRANCH);
    const detached = probeOf({ worktreeRoot: "/wt/a", branch: "HEAD", head: "c".repeat(40) });
    expect(checkRunGitOrigin("/wt/a", origin, detached)).toContain("detached");
  });

  it("refuses when the worktree root changed, naming both roots", () => {
    const origin = captureRunGitOrigin("/wt/a", ON_BRANCH);
    const elsewhere = probeOf({ worktreeRoot: "/wt/b", branch: "feat/x", head: "a".repeat(40) });
    const reason = checkRunGitOrigin("/wt/a", origin, elsewhere);
    expect(reason).toContain("/wt/a");
    expect(reason).toContain("/wt/b");
  });

  it("refuses when the directory is no longer a git worktree", () => {
    const origin = captureRunGitOrigin("/wt/a", ON_BRANCH);
    expect(checkRunGitOrigin("/wt/a", origin, probeOf({}))).toContain("no longer inside a git worktree");
  });

  it("allows a run that started detached and stayed at the same commit", () => {
    const detached = probeOf({ worktreeRoot: "/wt/a", branch: "HEAD", head: "b".repeat(40) });
    const origin = captureRunGitOrigin("/wt/a", detached);
    expect(checkRunGitOrigin("/wt/a", origin, detached)).toBeUndefined();
  });

  it("refuses a run that started detached and moved to another commit", () => {
    const origin = captureRunGitOrigin(
      "/wt/a",
      probeOf({ worktreeRoot: "/wt/a", branch: "HEAD", head: "b".repeat(40) }),
    );
    const moved = probeOf({ worktreeRoot: "/wt/a", branch: "HEAD", head: "c".repeat(40) });
    expect(checkRunGitOrigin("/wt/a", origin, moved)).toContain("cccccccc");
  });

  it("refuses a run that started detached and is now on a branch", () => {
    const origin = captureRunGitOrigin(
      "/wt/a",
      probeOf({ worktreeRoot: "/wt/a", branch: "HEAD", head: "b".repeat(40) }),
    );
    const onBranch = probeOf({ worktreeRoot: "/wt/a", branch: "main", head: "b".repeat(40) });
    expect(checkRunGitOrigin("/wt/a", origin, onBranch)).toContain("main");
  });

  it("enforces nothing when no origin was captured", () => {
    expect(checkRunGitOrigin("/wt/a", undefined, ON_BRANCH)).toBeUndefined();
    expect(checkRunGitOrigin("/wt/a", {} as RunGitOrigin, ON_BRANCH)).toBeUndefined();
  });
});
