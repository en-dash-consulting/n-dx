import { describe, it, expect } from "vitest";
import { collectWorktreeOptions } from "../../../src/viewer/views/hench-runs.js";

type Run = { worktree?: { name: string; path: string; branch: string | null } };
const wt = (name: string, path: string, branch: string | null = "main"): Run => ({ worktree: { name, path, branch } });
const noWorktree: Run = {};

describe("collectWorktreeOptions", () => {
  it("returns one option per distinct worktree path with run counts, sorted by name", () => {
    const runs: Run[] = [
      wt("zeta", "/w/zeta", "feat"),
      wt("alpha", "/w/alpha"),
      wt("alpha", "/w/alpha"),
      noWorktree,
    ];
    expect(collectWorktreeOptions(runs)).toEqual([
      { name: "alpha", path: "/w/alpha", branch: "main", runs: 2 },
      { name: "zeta", path: "/w/zeta", branch: "feat", runs: 1 },
    ]);
  });

  it("keeps two worktrees that share a basename apart", () => {
    const runs = [wt("repo", "/a/repo"), wt("repo", "/b/.claude/worktrees/repo", null)];
    const options = collectWorktreeOptions(runs);
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.path)).toEqual(["/a/repo", "/b/.claude/worktrees/repo"]);
  });

  it("is empty when no run carries a worktree (default-scope responses)", () => {
    expect(collectWorktreeOptions([noWorktree, noWorktree])).toEqual([]);
  });
});
