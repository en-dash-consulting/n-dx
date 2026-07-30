import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for review mode — the approval gate between agent completion
 * and task status updates.
 *
 * Review mode shows the agent's proposed changes (git diff) and
 * prompts the user to approve or reject before finalizing.
 */

// Mock child_process.execFile before importing the module
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock output module to suppress console noise in tests
vi.mock("../../../src/cli/output.js", () => ({
  section: vi.fn(),
  subsection: vi.fn(),
  info: vi.fn(),
  stream: vi.fn(),
  detail: vi.fn(),
  result: vi.fn(),
}));

import { execFile } from "node:child_process";

const mockExecFile = vi.mocked(execFile);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// collectReviewDiff
// ---------------------------------------------------------------------------

describe("collectReviewDiff", () => {
  it("returns diff and stat from git", async () => {
    const { collectReviewDiff } = await import("../../../src/agent/analysis/review.js");

    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
        callCount++;
        if ((args as string[]).includes("--stat")) {
          cb(null, " src/foo.ts | 10 ++++---\n 1 file changed\n", "");
        } else {
          cb(null, "diff --git a/src/foo.ts b/src/foo.ts\n+added line\n", "");
        }
      }) as typeof execFile,
    );

    const result = await collectReviewDiff("/project");

    expect(result.stat).toBe("src/foo.ts | 10 ++++---\n 1 file changed");
    expect(result.diff).toContain("+added line");
  });

  it("handles empty diff gracefully", async () => {
    const { collectReviewDiff } = await import("../../../src/agent/analysis/review.js");

    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "", "");
      }) as typeof execFile,
    );

    const result = await collectReviewDiff("/project");

    expect(result.diff).toBe("");
    expect(result.stat).toBe("");
  });

  it("handles git errors without crashing", async () => {
    const { collectReviewDiff } = await import("../../../src/agent/analysis/review.js");

    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error("not a git repository"), "", "");
      }) as typeof execFile,
    );

    const result = await collectReviewDiff("/project");

    // Should not throw — returns empty strings on error
    expect(result.diff).toBe("");
    expect(result.stat).toBe("");
  });
});

// ---------------------------------------------------------------------------
// promptReview
// ---------------------------------------------------------------------------

describe("promptReview", () => {
  it("approves on empty input (default yes)", async () => {
    const { promptReview } = await import("../../../src/agent/analysis/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "");

    expect(result.approved).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("approves on 'y' input", async () => {
    const { promptReview } = await import("../../../src/agent/analysis/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "y");

    expect(result.approved).toBe(true);
  });

  it("approves on 'yes' input", async () => {
    const { promptReview } = await import("../../../src/agent/analysis/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "yes");

    expect(result.approved).toBe(true);
  });

  it("approves on 'Y' input (case-insensitive)", async () => {
    const { promptReview } = await import("../../../src/agent/analysis/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "Y");

    expect(result.approved).toBe(true);
  });

  it("rejects on 'n' input", async () => {
    const { promptReview } = await import("../../../src/agent/analysis/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "n");

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Changes rejected by reviewer");
  });

  it("rejects on 'no' input", async () => {
    const { promptReview } = await import("../../../src/agent/analysis/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "no");

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Changes rejected by reviewer");
  });

  it("rejects on any non-yes input", async () => {
    const { promptReview } = await import("../../../src/agent/analysis/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "maybe");

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Changes rejected by reviewer");
  });
});

// ---------------------------------------------------------------------------
// revertChanges — scoped rollback (issue #303)
// ---------------------------------------------------------------------------
//
// revertChanges must NEVER blanket-delete untracked files. It reverts tracked
// modifications (recoverable from git history) and removes ONLY untracked
// files the agent created during the run, as determined by diffing the current
// untracked set against a baseline captured before the run started. When no
// baseline is supplied it deletes nothing — the user's pre-existing untracked
// files (.env, local scratch, hidden files) are always preserved.

/**
 * Install an execFile mock that reports `untrackedNow` as the current set of
 * untracked paths for `git status --porcelain`, and succeeds silently for all
 * other git commands. Returns nothing — inspect `mockExecFile.mock.calls`.
 */
function mockGitWithUntracked(untrackedNow: string[]): void {
  mockExecFile.mockImplementation(
    ((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      const a = args as string[];
      if (a[0] === "status") {
        const body = untrackedNow.map((p) => `?? ${p}`).join("\n");
        cb(null, body ? body + "\n" : "", "");
      } else {
        cb(null, "", "");
      }
    }) as typeof execFile,
  );
}

/** Return the recorded git-clean call's argument array, or undefined if none. */
function findCleanCall(): string[] | undefined {
  const call = mockExecFile.mock.calls.find(
    (c) => (c[1] as string[])[0] === "clean",
  );
  return call ? (call[1] as string[]) : undefined;
}

describe("revertChanges", () => {
  it("reverts tracked changes with git reset then checkout", async () => {
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    mockGitWithUntracked([]);

    await revertChanges("/project", { baselineUntracked: [] });

    const args = mockExecFile.mock.calls.map((c) => c[1] as string[]);
    expect(args).toContainEqual(["reset", "HEAD", "."]);
    expect(args).toContainEqual(["checkout", "."]);
    // reset must precede checkout
    const resetIdx = args.findIndex((a) => a[0] === "reset");
    const checkoutIdx = args.findIndex((a) => a[0] === "checkout");
    expect(resetIdx).toBeLessThan(checkoutIdx);
  });

  it("removes ONLY untracked files created after the baseline", async () => {
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    // "keep.txt" existed before the run; "agent-new.txt" was created by the agent.
    mockGitWithUntracked(["keep.txt", "agent-new.txt"]);

    const result = await revertChanges("/project", {
      baselineUntracked: ["keep.txt"],
    });

    const cleanArgs = findCleanCall();
    expect(cleanArgs).toBeDefined();
    // Scoped clean: pathspec after "--" contains only the agent-created file.
    expect(cleanArgs).toEqual(["clean", "-fd", "--", "agent-new.txt"]);
    expect(cleanArgs).not.toContain("keep.txt");

    expect(result.removedUntracked).toEqual(["agent-new.txt"]);
    expect(result.keptUntracked).toEqual(["keep.txt"]);
  });

  it("NEVER deletes untracked files when no baseline is provided", async () => {
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    mockGitWithUntracked(["user-scratch.txt", ".env"]);

    const result = await revertChanges("/project");

    // No git clean must be issued at all — the data-loss guard.
    expect(findCleanCall()).toBeUndefined();
    expect(result.removedUntracked).toEqual([]);
    expect(result.keptUntracked).toEqual(["user-scratch.txt", ".env"]);
  });

  it("never runs git clean when the agent created no new untracked files", async () => {
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    // Current untracked set is identical to the baseline → nothing to remove.
    mockGitWithUntracked(["keep.txt", ".env"]);

    const result = await revertChanges("/project", {
      baselineUntracked: ["keep.txt", ".env"],
    });

    expect(findCleanCall()).toBeUndefined();
    expect(result.removedUntracked).toEqual([]);
    expect(result.keptUntracked).toEqual(["keep.txt", ".env"]);
  });

  it("preserves pre-existing hidden/untracked files while removing agent files", async () => {
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    // .env and .secret pre-exist; the agent added tmp-output.log.
    mockGitWithUntracked([".env", ".secret", "tmp-output.log"]);

    const result = await revertChanges("/project", {
      baselineUntracked: [".env", ".secret"],
    });

    const cleanArgs = findCleanCall();
    expect(cleanArgs).toEqual(["clean", "-fd", "--", "tmp-output.log"]);
    expect(cleanArgs).not.toContain(".env");
    expect(cleanArgs).not.toContain(".secret");
    expect(result.keptUntracked).toEqual([".env", ".secret"]);
  });

  it("handles git errors without crashing", async () => {
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error("git error"), "", "");
      }) as typeof execFile,
    );

    // Should not throw; with no parseable untracked output, nothing is removed.
    const result = await revertChanges("/project", { baselineUntracked: [] });
    expect(result.removedUntracked).toEqual([]);
  });

  it("passes projectDir as cwd and honors custom timeout on git commands", async () => {
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    mockGitWithUntracked(["new.txt"]);

    await revertChanges("/my/project/path", {
      baselineUntracked: [],
      timeout: 60_000,
    });

    for (const call of mockExecFile.mock.calls) {
      const opts = call[2] as { cwd: string; timeout: number };
      expect(opts.cwd).toBe("/my/project/path");
      expect(opts.timeout).toBe(60_000);
    }
  });
});
