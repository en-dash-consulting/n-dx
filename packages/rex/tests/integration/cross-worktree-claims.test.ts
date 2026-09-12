/**
 * Task selection across two worktrees of one repository.
 *
 * The unit tests around `openClaimsStore` prove the store agrees with itself.
 * What they cannot prove is the thing the feature exists for: that a claim
 * taken in one *checkout* changes what a *different* checkout is handed when it
 * asks what to work on next. That needs two real worktrees, a real PRD, and the
 * real `rex next` command — which is what this file sets up.
 *
 * `rex next` is the selection surface under test rather than `hench next`
 * (which does not exist): hench autoselects through `findNextTask` in
 * `assembleTaskBrief`, the same function and the same `excludeIds` option this
 * exercises, and its own claim/release wiring is covered in
 * `packages/hench/tests/unit/prd/task-claims.test.ts`.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getWorktreeRoot } from "@n-dx/llm-client";
import { openClaimsStore } from "../../src/store/claims.js";

const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");

/** A live PID that is not this process, so its claims read as someone else's. */
const LIVE_FOREIGN_PID = process.ppid;

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "ignore" });
}

function rex(dir: string, args: string[]): string {
  return execFileSync("node", [cliPath, ...args], { encoding: "utf-8", timeout: 20000, cwd: dir });
}

/** `rex next --format=json` for a directory. */
function nextTask(dir: string): { item?: { id: string }; skippedClaims: Array<{ taskId: string; worktreeRoot: string }> } {
  const raw = rex(dir, ["next", "--format=json", dir]);
  const start = raw.indexOf("{");
  return JSON.parse(raw.slice(start));
}

describe("cross-worktree task claims", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeTmpDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  /**
   * A git repository with a PRD holding two actionable sibling tasks, plus a
   * linked worktree of it. Both checkouts see the same claims file; only the
   * first has the PRD in its working tree, so B reads the PRD through A's path
   * while resolving claims through its own worktree root.
   */
  async function makeRepoWithWorktree(): Promise<{ repo: string; linked: string; first: string; second: string }> {
    const repo = await makeTmpDir("rex-claims-e2e-");
    git(repo, ["init", "--quiet"]);

    rex(repo, ["init", repo]);
    const epic = extractId(rex(repo, ["add", "epic", "--title=Epic", repo]));
    const first = extractId(rex(repo, ["add", "task", "--title=First task", `--parent=${epic}`, "--priority=high", repo]));
    const second = extractId(rex(repo, ["add", "task", "--title=Second task", `--parent=${epic}`, "--priority=high", repo]));

    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "prd", "--quiet"]);

    const linked = join(await makeTmpDir("rex-claims-wt-"), "wt");
    git(repo, ["worktree", "add", "--quiet", "--detach", linked]);

    return { repo, linked, first, second };
  }

  function extractId(output: string): string {
    const match = output.match(/ID: (.+)/);
    if (!match?.[1]) throw new Error(`No ID in output: ${output}`);
    return match[1].trim();
  }

  it("hands worktree B the next unclaimed task while worktree A holds the first", async () => {
    const { repo, linked, first, second } = await makeRepoWithWorktree();

    // Both checkouts agree on the pick before anyone claims anything.
    expect(nextTask(repo).item?.id).toBe(first);
    expect(nextTask(linked).item?.id).toBe(first);

    // Worktree A takes it.
    const claimed = await openClaimsStore(repo).claim(first, { pid: LIVE_FOREIGN_PID });
    expect(claimed).toBe(true);

    // B moves on to the next one; A, which holds the claim, still sees its own task.
    expect(nextTask(linked).item?.id).toBe(second);
    expect(nextTask(repo).item?.id).toBe(first);
  });

  it("reports what it skipped, and who is holding it", async () => {
    const { repo, linked, first } = await makeRepoWithWorktree();
    await openClaimsStore(repo).claim(first, { pid: LIVE_FOREIGN_PID });

    const skipped = nextTask(linked).skippedClaims;
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.taskId).toBe(first);
    // git reports resolved paths, so compare against what git itself says the
    // holding worktree is rather than the tmpdir path we happen to hold.
    expect(skipped[0]?.worktreeRoot).toBe(getWorktreeRoot(repo));
  });

  it("frees the task again once the claim is released", async () => {
    const { repo, linked, first } = await makeRepoWithWorktree();
    const store = openClaimsStore(repo);
    await store.claim(first, { pid: LIVE_FOREIGN_PID });
    expect(nextTask(linked).item?.id).not.toBe(first);

    await store.release(first, { pid: LIVE_FOREIGN_PID });
    expect(nextTask(linked).item?.id).toBe(first);
  });
});
