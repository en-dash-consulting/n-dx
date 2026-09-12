import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import {
  PRD_COMMIT_PATHS,
  findUncommittedWork,
  formatLoopRefusal,
  formatUncommittedWorkRefusal,
} from "../../../../src/agent/lifecycle/uncommitted-work-gate.js";

/**
 * A directory that is not inside any git repository, so the repo-relative
 * prefix resolves to "" and the porcelain lines below compare as written.
 * The nested-project behaviour (a non-empty prefix) is covered against real
 * repositories in tests/unit/agent/pre-run-gate-own-state.test.ts.
 */
const OUTSIDE_ANY_REPO = tmpdir();

/** Build gate options with the git call replaced by a canned porcelain list. */
function withDirty(lines: string[], overrides: { stagedCommitFollows?: boolean; discountPaths?: string[] } = {}) {
  return {
    projectDir: OUTSIDE_ANY_REPO,
    stagedCommitFollows: overrides.stagedCommitFollows,
    discountPaths: overrides.discountPaths,
    deps: { listDirty: vi.fn(async () => lines) },
  };
}

describe("findUncommittedWork", () => {
  it("reports a clean tree as clean", async () => {
    await expect(findUncommittedWork(withDirty([]))).resolves.toEqual({
      clean: true,
      paths: [],
    });
  });

  it("refuses when the agent left its work in the tree", async () => {
    // The exact shape of the observed failure: a new test file plus a stray
    // scratch log, neither of them committed, on the autoCommit path.
    const result = await findUncommittedWork(
      withDirty(["?? packages/hench/tests/unit/process/git-origin.test.ts", "?? root-test-output.log"]),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual([
      "packages/hench/tests/unit/process/git-origin.test.ts",
      "root-test-output.log",
    ]);
  });

  it("does not count hench's own runtime artifacts as work", async () => {
    // Same discount as the pre-run gate: a lock file hench created at startup
    // must not fail the task it was created for.
    await expect(
      findUncommittedWork(
        withDirty(["?? .hench/locks/1234.lock", "?? .hench/runs/2026-09-11-abc.json", "?? .hench/usage-cursors/s1.json"]),
      ),
    ).resolves.toEqual({ clean: true, paths: [] });
  });

  it("does not count the PRD paths the completion commit still covers", async () => {
    await expect(
      findUncommittedWork(
        withDirty([" M .rex/prd_tree/some-task/index.md"], { discountPaths: [...PRD_COMMIT_PATHS] }),
      ),
    ).resolves.toEqual({ clean: true, paths: [] });
  });

  it("does not count the tree-meta sidecar every PRD write rewrites", async () => {
    // Every store save rewrites `.rex/tree-meta.json`, and where the committed
    // copy predates the schema marker the rewrite changes its bytes. Left out
    // of the discount list it refused every completion in this repo.
    await expect(
      findUncommittedWork(
        withDirty([" M .rex/tree-meta.json"], { discountPaths: [...PRD_COMMIT_PATHS] }),
      ),
    ).resolves.toEqual({ clean: true, paths: [] });
  });

  it("does not treat the sidecar prefix as a directory", async () => {
    // `.rex/tree-meta.json` is a file entry, so a sibling that merely starts
    // with the same characters must still be reported.
    const result = await findUncommittedWork(
      withDirty([" M .rex/tree-meta.json.bak"], { discountPaths: [...PRD_COMMIT_PATHS] }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual([".rex/tree-meta.json.bak"]);
  });

  it("still refuses on operator .rex content outside the PRD tree", async () => {
    const result = await findUncommittedWork(
      withDirty([" M .rex/config.json"], { discountPaths: [...PRD_COMMIT_PATHS] }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual([".rex/config.json"]);
  });

  it("discounts fully staged paths when a commit of the index still follows", async () => {
    // The interactive path: the agent stages its work and writes a commit
    // message, and performCommitPromptIfNeeded runs `git commit -F` next.
    await expect(
      findUncommittedWork(withDirty(["M  src/a.ts", "A  src/b.ts"], { stagedCommitFollows: true })),
    ).resolves.toEqual({ clean: true, paths: [] });
  });

  it("refuses staged paths on the autoCommit path, where nothing commits them", async () => {
    const result = await findUncommittedWork(
      withDirty(["M  src/a.ts"], { stagedCommitFollows: false }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual(["src/a.ts"]);
  });

  it("refuses a staged path that was edited again after staging", async () => {
    // `MM` commits the staged half and leaves the rest behind — a partial
    // commit is still a leak.
    const result = await findUncommittedWork(
      withDirty(["MM src/a.ts"], { stagedCommitFollows: true }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual(["src/a.ts"]);
  });

  it("refuses untracked files even when a commit of the index follows", async () => {
    // `git commit -F` never picks up an untracked file.
    const result = await findUncommittedWork(
      withDirty(["?? notes.md"], { stagedCommitFollows: true }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual(["notes.md"]);
  });

  it("refuses an unmerged path", async () => {
    const result = await findUncommittedWork(
      withDirty(["UU src/a.ts"], { stagedCommitFollows: true }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual(["src/a.ts"]);
  });

  it("discounts explicit pending paths such as review repairs", async () => {
    await expect(
      findUncommittedWork(
        withDirty([" M src/repaired.ts"], { discountPaths: ["src/repaired.ts"] }),
      ),
    ).resolves.toEqual({ clean: true, paths: [] });
  });

  it("reads the destination path of a rename", async () => {
    const result = await findUncommittedWork(withDirty(["R  old.ts -> new.ts"]));
    expect(result.paths).toEqual(["new.ts"]);
  });
});

describe("refusal messages", () => {
  it("names every uncommitted path and says nothing was discarded", () => {
    const message = formatUncommittedWorkRefusal(["src/a.ts", "root-test-output.log"]);
    expect(message).toContain("src/a.ts");
    expect(message).toContain("root-test-output.log");
    expect(message).toContain("2 path(s)");
    expect(message).toContain("Nothing was discarded");
  });

  it("truncates a very long path list rather than flooding the log", () => {
    const paths = Array.from({ length: 25 }, (_, i) => `src/file-${i}.ts`);
    const message = formatUncommittedWorkRefusal(paths);
    expect(message).toContain("src/file-19.ts");
    expect(message).not.toContain("src/file-20.ts");
    expect(message).toContain("…and 5 more");
  });

  it("explains why the loop stopped", () => {
    const message = formatLoopRefusal(["src/a.ts"]);
    expect(message).toContain("previous task");
    expect(message).toContain("src/a.ts");
  });
});
