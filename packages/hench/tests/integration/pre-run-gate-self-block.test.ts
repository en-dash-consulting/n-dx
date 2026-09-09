import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { performPreRunCommitGateIfNeeded } from "../../src/agent/lifecycle/shared.js";
import { measureChangeMagnitude } from "../../src/agent/analysis/change-magnitude.js";
import { initGitFixtureRepo } from "../helpers/index.js";

const execFile = promisify(execFileCb);

/**
 * Regression: `ndx work --auto` on a freshly initialized project refused to
 * start with "Refusing to start an autonomous run with 1 uncommitted file(s),
 * 0 line(s) changed in the working tree", then left a clean tree behind so
 * the message looked unreproducible.
 *
 * The dirt was hench's own `.hench/locks/`, created at process startup before
 * the gate runs and removed again on exit. These tests drive the real gate
 * against a real git repository — no `deps.listDirty` seam — so they exercise
 * the actual `git status --porcelain` parse that produced the false positive.
 *
 * `hench init` gitignoring the path is the other half of the fix (covered in
 * e2e/cli-init.test.ts); this half is what holds on a project initialized
 * before those entries existed.
 */
describe("pre-run commit gate vs hench's own runtime artifacts", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-self-block-"));
    henchDir = join(projectDir, ".hench");
    await mkdir(henchDir, { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);
    await writeFile(join(projectDir, "README.md"), "# fixture\n", "utf-8");
    // Commit .hench/config.json, as an initialized project does. It matters
    // that something under .hench/ is tracked: git collapses a wholly
    // untracked directory to a single `?? .hench/` entry, and only descends
    // to `?? .hench/locks/` once a sibling is tracked. The reported bug was
    // the latter form.
    await writeFile(join(henchDir, "config.json"), '{ "model": "sonnet" }\n', "utf-8");
    await execFile("git", ["add", "."], { cwd: projectDir });
    await execFile("git", ["commit", "-m", "initial"], { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  /** Create the lock directory exactly as ProcessLimiter does at startup. */
  async function createLockDir(): Promise<void> {
    const locks = join(henchDir, "locks");
    await mkdir(locks, { recursive: true });
    await writeFile(join(locks, `${process.pid}.lock`), "{}", "utf-8");
  }

  it("reports the lock directory as dirt without the discount", async () => {
    // Pins the precondition the fix relies on: git really does surface the
    // run's own lock directory. If this stops being true the discount below
    // is no longer load-bearing and should be re-justified, not deleted.
    await createLockDir();
    const { stdout } = await execFile("git", ["status", "--porcelain"], { cwd: projectDir });
    expect(stdout).toContain(".hench/locks/");
  });

  it("proceeds with an autonomous run when the only dirt is its own lock", async () => {
    await createLockDir();

    const result = await performPreRunCommitGateIfNeeded({
      projectDir,
      henchDir,
      autonomous: true,
      deps: { isTTY: false },
    });

    expect(result).toBe("proceed");
  });

  it("proceeds when run records and the commit-message scratch file are present", async () => {
    await createLockDir();
    await mkdir(join(henchDir, "runs"), { recursive: true });
    await writeFile(join(henchDir, "runs", "run-1.json"), "{}", "utf-8");
    await mkdir(join(henchDir, "usage-cursors"), { recursive: true });
    await writeFile(join(henchDir, "usage-cursors", "s1.json"), "{}", "utf-8");
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "wip\n", "utf-8");

    const result = await performPreRunCommitGateIfNeeded({
      projectDir,
      henchDir,
      autonomous: true,
      deps: { isTTY: false },
    });

    expect(result).toBe("proceed");
  });

  it("still stops an autonomous run on genuine operator changes", async () => {
    await createLockDir();
    await writeFile(join(projectDir, "README.md"), "# fixture\n\nedited\n", "utf-8");

    const result = await performPreRunCommitGateIfNeeded({
      projectDir,
      henchDir,
      autonomous: true,
      deps: { isTTY: false },
    });

    expect(result).toBe("stop");
  });

  it("still stops on an uncommitted hench config change", async () => {
    // .hench/config.json is operator-authored — discounting the whole .hench/
    // tree would let a real pending change get folded into hench's commits.
    await createLockDir();
    await writeFile(join(henchDir, "config.json"), "{}", "utf-8");

    const result = await performPreRunCommitGateIfNeeded({
      projectDir,
      henchDir,
      autonomous: true,
      deps: { isTTY: false },
    });

    expect(result).toBe("stop");
  });

  it("does not count the lock directory in the change magnitude", async () => {
    await createLockDir();
    expect(await measureChangeMagnitude(projectDir)).toEqual({ files: 0, linesChanged: 0 });
  });

  it("still stops when the whole .hench/ directory is untracked", async () => {
    // The discount is deliberately narrow. With nothing under .hench/ tracked,
    // git reports one collapsed `?? .hench/` entry that also covers the
    // operator's config.json — real uncommitted content, so stopping is
    // correct, and unlike the lock the directory is still there afterwards.
    await execFile("git", ["rm", "-r", "--cached", ".hench"], { cwd: projectDir });
    await execFile("git", ["commit", "-m", "untrack hench"], { cwd: projectDir });
    await createLockDir();

    const { stdout } = await execFile("git", ["status", "--porcelain"], { cwd: projectDir });
    expect(stdout.trim()).toBe("?? .hench/");

    const result = await performPreRunCommitGateIfNeeded({
      projectDir,
      henchDir,
      autonomous: true,
      deps: { isTTY: false },
    });

    expect(result).toBe("stop");
  });
});
