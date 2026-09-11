import { describe, it, expect, vi, beforeEach } from "vitest";

// Gate-wiring tests below exercise checkRunGitOrigin's *default* probe
// (realGitOriginProbe), which calls through to process/exec.js — hench's
// process gateway, re-exporting @n-dx/llm-client's git helpers. Mocked here
// rather than spawning real git, matching the style already used for this
// module in tests/unit/process/actor-identity.test.ts and
// tests/unit/agent/review-gate-rollback.test.ts.
const { mockGetWorktreeRoot, mockGetCurrentBranch, mockGetCurrentHead } = vi.hoisted(() => ({
  mockGetWorktreeRoot: vi.fn(),
  mockGetCurrentBranch: vi.fn(),
  mockGetCurrentHead: vi.fn(),
}));

vi.mock("../../../src/process/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/process/exec.js")>();
  return {
    ...actual,
    getWorktreeRoot: mockGetWorktreeRoot,
    getCurrentBranch: mockGetCurrentBranch,
    getCurrentHead: mockGetCurrentHead,
  };
});

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

/**
 * The four automatic-commit call sites (pre-run gate, completion metadata,
 * review repairs, commit-message watcher) all call checkRunGitOrigin with no
 * probe argument, so they run through realGitOriginProbe — i.e. the actual
 * process/exec.js gateway. The suites above prove the comparison logic against
 * a hand-built GitOriginProbe; these prove the default wiring behaves the same
 * way once process/exec.js is mocked instead of a custom probe.
 */
describe("checkRunGitOrigin (default probe, gateway mocked)", () => {
  beforeEach(() => {
    mockGetWorktreeRoot.mockReset();
    mockGetCurrentBranch.mockReset();
    mockGetCurrentHead.mockReset();
  });

  it("allows the commit when branch and worktree root are unchanged", () => {
    mockGetWorktreeRoot.mockReturnValue("/real/project");
    mockGetCurrentBranch.mockReturnValue("feat/x");
    mockGetCurrentHead.mockReturnValue("a".repeat(40));

    const origin = captureRunGitOrigin("/real/project");

    expect(checkRunGitOrigin("/real/project", origin)).toBeUndefined();
  });

  it("refuses the commit when the branch changed, naming expected and actual", () => {
    mockGetWorktreeRoot.mockReturnValue("/real/project");
    mockGetCurrentBranch.mockReturnValue("feat/x");
    mockGetCurrentHead.mockReturnValue("a".repeat(40));
    const origin = captureRunGitOrigin("/real/project");

    mockGetCurrentBranch.mockReturnValue("main");
    const reason = checkRunGitOrigin("/real/project", origin);

    expect(reason).toContain("feat/x");
    expect(reason).toContain("main");
  });

  it("refuses when HEAD is detached at a different commit than the run started at", () => {
    mockGetWorktreeRoot.mockReturnValue("/real/project");
    mockGetCurrentBranch.mockReturnValue("HEAD"); // detached at capture
    mockGetCurrentHead.mockReturnValue("b".repeat(40));
    const origin = captureRunGitOrigin("/real/project");

    mockGetCurrentHead.mockReturnValue("c".repeat(40)); // moved while still detached
    const reason = checkRunGitOrigin("/real/project", origin);

    expect(reason).toContain("detached");
    expect(reason).toContain("cccccccc");
  });

  it("allows the commit when HEAD is still detached at the run's starting commit", () => {
    mockGetWorktreeRoot.mockReturnValue("/real/project");
    mockGetCurrentBranch.mockReturnValue("HEAD");
    mockGetCurrentHead.mockReturnValue("b".repeat(40));
    const origin = captureRunGitOrigin("/real/project");

    expect(checkRunGitOrigin("/real/project", origin)).toBeUndefined();
  });

  it("does not flag a mismatch when a symlinked project path and its realpath resolve to the same worktree root", () => {
    // Mirrors getWorktreeRoot's real contract (llm-client's gitRevParsePath):
    // it realpath-resolves its answer, so it returns the same canonical root
    // no matter which path the caller's cwd took to reach it. The mock
    // reproduces that by returning one fixed, already-normalized value
    // regardless of the (different) cwd strings passed at capture and check
    // time below — capture goes in via a symlinked path (e.g. macOS's
    // /tmp -> /private/tmp), check goes in via the realpath directly.
    mockGetWorktreeRoot.mockReturnValue("/private/tmp/project");
    mockGetCurrentBranch.mockReturnValue("feat/x");
    mockGetCurrentHead.mockReturnValue("a".repeat(40));

    const origin = captureRunGitOrigin("/tmp/project");
    expect(origin.worktreeRoot).toBe("/private/tmp/project");

    expect(checkRunGitOrigin("/private/tmp/project", origin)).toBeUndefined();
    expect(mockGetWorktreeRoot).toHaveBeenCalledWith("/tmp/project");
    expect(mockGetWorktreeRoot).toHaveBeenCalledWith("/private/tmp/project");
  });
});
