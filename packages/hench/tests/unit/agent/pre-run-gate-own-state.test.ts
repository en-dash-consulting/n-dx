/**
 * hench's own runtime state is not operator dirt.
 *
 * `ndx work --auto` refused to start on a freshly initialised project with
 * "Refusing to start an autonomous run with 1 uncommitted file(s), 0 line(s)
 * changed in the working tree" — and the tree read clean to anyone who checked
 * afterwards, so the report looked unreproducible.
 *
 * The file was `.hench/locks/`, which hench creates the instant a run starts,
 * before any real work happens, and removes on exit. The run blocked on an
 * artifact it had just created itself, then erased the evidence.
 *
 * `hench init` now gitignores those paths, which fixes the fresh-project case
 * (see tests/e2e/cli-init.test.ts). It does not fix every case: a project
 * initialised before that landed, or one whose `.gitignore` was edited, still
 * self-blocks. The gate should not depend on a `.gitignore` entry to avoid
 * counting its own lock file — a path hench wrote for its own bookkeeping is
 * never a change the operator needs to commit or stash.
 *
 * `.hench/config.json` is deliberately NOT in that set. It is meant to be
 * committed, so an edit to it is genuine operator work and must still count.
 *
 * @see packages/hench/src/schema/v1.ts — HENCH_RUNTIME_ARTIFACTS
 * @see packages/hench/src/agent/lifecycle/shared.ts — the gate
 */

import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performPreRunCommitGateIfNeeded } from "../../../src/agent/lifecycle/shared.js";
import { HENCH_RUNTIME_ARTIFACTS } from "../../../src/schema/index.js";

/** Porcelain lines as `git status --porcelain` would emit them. */
const OWN_STATE = [
  "?? .hench/locks/",
  "?? .hench/runs/",
  "?? .hench/usage-cursors/",
  "?? .hench-commit-msg.txt",
];

/**
 * Drive the gate with a stubbed git surface.
 *
 * `autonomous` with no `allowDirty` is the failing path from the report: it
 * cannot prompt, so it either proceeds or refuses.
 */
async function runGate(dirty: string[]) {
  const calls = { measured: 0 };
  const result = await performPreRunCommitGateIfNeeded({
    projectDir: "/tmp/project",
    henchDir: "/tmp/project/.hench",
    model: "claude-sonnet-5",
    yes: false,
    autonomous: true,
    allowDirty: false,
    dryRun: false,
    deps: {
      listDirty: async () => dirty,
      measureMagnitude: async () => {
        calls.measured++;
        return { linesChanged: 0, filesChanged: 0 } as never;
      },
      isTTY: false,
    },
  } as never);
  return { result, calls };
}

describe("the pre-run gate ignores hench's own runtime state", () => {
  it("declares the artifact set", () => {
    expect(HENCH_RUNTIME_ARTIFACTS).toEqual(
      expect.arrayContaining([
        ".hench/locks/",
        ".hench/runs/",
        ".hench/usage-cursors/",
        ".hench-commit-msg.txt",
      ]),
    );
  });

  it("does not treat .hench/config.json as runtime state", () => {
    // It is meant to be committed; an edit to it is real operator work.
    expect(HENCH_RUNTIME_ARTIFACTS).not.toContain(".hench/config.json");
    expect(HENCH_RUNTIME_ARTIFACTS.some((p) => p === ".hench/" || p === ".hench")).toBe(false);
  });

  it.each(OWN_STATE)("proceeds when the only dirty path is %s", async (path) => {
    const { result } = await runGate([path]);
    expect(result).toBe("proceed");
  });

  it("proceeds when every dirty path is hench's own", async () => {
    const { result, calls } = await runGate(OWN_STATE);
    expect(result).toBe("proceed");
    // Nothing to weigh, so the magnitude probe should not even run.
    expect(calls.measured).toBe(0);
  });

  it("still refuses when the operator has real uncommitted work", async () => {
    const { result } = await runGate([" M src/index.ts", "?? .hench/locks/"]);
    expect(result).toBe("stop");
  });

  it("still counts an edit to the committed config file", async () => {
    const { result } = await runGate([" M .hench/config.json"]);
    expect(result).toBe("stop");
  });
});

// ── Against a real repository ───────────────────────────────────────────────

describe("the gate against a real git repository", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** A committed repo with hench's startup lock present and NOT gitignored. */
  function repoWithHenchLock(): string {
    const dir = mkdtempSync(join(tmpdir(), "hench-gate-"));
    dirs.push(dir);
    const git = (args: string) => execSync(`git ${args}`, { cwd: dir, stdio: "pipe" });
    git("init -q");
    git("config user.email test@example.com");
    git("config user.name test");
    writeFileSync(join(dir, "README.md"), "# t\n");
    git("add -A");
    git("commit -qm init");

    // Exactly what process/limiter.ts does at startup.
    mkdirSync(join(dir, ".hench", "locks"), { recursive: true });
    writeFileSync(join(dir, ".hench", "locks", "run.lock"), "pid\n");
    return dir;
  }

  const gate = (dir: string) =>
    performPreRunCommitGateIfNeeded({
      projectDir: dir,
      henchDir: join(dir, ".hench"),
      model: "claude-sonnet-5",
      yes: false,
      autonomous: true,
      allowDirty: false,
      dryRun: false,
    } as never);

  it("starts a run whose only dirty path is the lock it just created", async () => {
    // The stubbed tests above pass whether or not this does. git collapses a
    // wholly-untracked directory to a single `?? .hench/` entry, so the filter
    // never saw `locks/` and the run still blocked — the exact reported bug,
    // invisible to a test that feeds porcelain lines in by hand.
    const dir = repoWithHenchLock();
    expect(
      execSync("git status --porcelain", { cwd: dir, encoding: "utf-8" }).trim(),
    ).toBe("?? .hench/");

    await expect(gate(dir)).resolves.toBe("proceed");
  });

  it("still refuses when the operator has real uncommitted work alongside it", async () => {
    const dir = repoWithHenchLock();
    writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");
    await expect(gate(dir)).resolves.toBe("stop");
  });
});
