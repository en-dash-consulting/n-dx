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
    const { collectReviewDiff } = await import("../../../src/agent/review.js");

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
    const { collectReviewDiff } = await import("../../../src/agent/review.js");

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
    const { collectReviewDiff } = await import("../../../src/agent/review.js");

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
    const { promptReview } = await import("../../../src/agent/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "");

    expect(result.approved).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("approves on 'y' input", async () => {
    const { promptReview } = await import("../../../src/agent/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "y");

    expect(result.approved).toBe(true);
  });

  it("approves on 'yes' input", async () => {
    const { promptReview } = await import("../../../src/agent/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "yes");

    expect(result.approved).toBe(true);
  });

  it("approves on 'Y' input (case-insensitive)", async () => {
    const { promptReview } = await import("../../../src/agent/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "Y");

    expect(result.approved).toBe(true);
  });

  it("rejects on 'n' input", async () => {
    const { promptReview } = await import("../../../src/agent/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "n");

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Changes rejected by reviewer");
  });

  it("rejects on 'no' input", async () => {
    const { promptReview } = await import("../../../src/agent/review.js");

    const diff = {
      diff: "+added line",
      stat: "1 file changed",
    };

    const result = await promptReview(diff, async () => "no");

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Changes rejected by reviewer");
  });

  it("rejects on any non-yes input", async () => {
    const { promptReview } = await import("../../../src/agent/review.js");

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
// revertChanges
// ---------------------------------------------------------------------------

describe("revertChanges", () => {
  it("runs git reset, checkout, and clean", async () => {
    const { revertChanges } = await import("../../../src/agent/review.js");

    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "", "");
      }) as typeof execFile,
    );

    await revertChanges("/project");

    // Should call git three times: reset, checkout, clean
    expect(mockExecFile).toHaveBeenCalledTimes(3);

    const calls = mockExecFile.mock.calls;
    expect(calls[0][0]).toBe("git");
    expect(calls[0][1]).toContain("reset");

    expect(calls[1][0]).toBe("git");
    expect(calls[1][1]).toContain("checkout");

    expect(calls[2][0]).toBe("git");
    expect(calls[2][1]).toContain("clean");
  });

  it("handles git errors without crashing", async () => {
    const { revertChanges } = await import("../../../src/agent/review.js");

    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error("git error"), "", "");
      }) as typeof execFile,
    );

    // Should not throw
    await revertChanges("/project");
  });
});
