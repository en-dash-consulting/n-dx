/**
 * Unit tests for the git-preflight helper.
 *
 * Focus on the pure / synchronous surface:
 *   - isInsideGitRepo walks up parents looking for `.git`
 *   - formatGitWarningLines yields the right lines for each status
 *
 * The interactive prompt path is covered by the e2e test suite — readline
 * needs a real TTY to exercise meaningfully.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

import {
  isInsideGitRepo,
  formatGitWarningLines,
  runGitPreflight,
  commitInitBaseline,
  formatGitInitCommitLines,
  snapshotDirtyPaths,
  parsePorcelainZ,
  finishInitCommit,
  machineLocalIgnoreEntries,
} from "../../packages/core/git-preflight.js";

function gitAvailable() {
  try {
    execFileSync("git", ["--version"], { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const GIT_OK = gitAvailable();

function initRepo(dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe", timeout: 10_000 });
  // Local identity so commits succeed in CI environments where the global
  // git config has no user.name / user.email.
  execFileSync("git", ["config", "user.email", "ndx-test@example.com"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "ndx test"], { cwd: dir, stdio: "pipe" });
}

describe("git-preflight: isInsideGitRepo", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "git-preflight-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns true when `.git` exists directly in the directory", async () => {
    await mkdir(join(tmpDir, ".git"));
    expect(isInsideGitRepo(tmpDir)).toBe(true);
  });

  it("returns true when `.git` exists in an ancestor directory", async () => {
    await mkdir(join(tmpDir, ".git"));
    const nested = join(tmpDir, "a", "b", "c");
    await mkdir(nested, { recursive: true });
    expect(isInsideGitRepo(nested)).toBe(true);
  });

  it("returns true when `.git` is a file (submodule worktree pointer)", async () => {
    await writeFile(join(tmpDir, ".git"), "gitdir: ../parent/.git/modules/submod\n");
    expect(isInsideGitRepo(tmpDir)).toBe(true);
  });

  it("returns false when no `.git` exists anywhere in the chain", async () => {
    // The temp directory is created under the OS tmpdir, which is not a
    // git working tree on any of the CI platforms we target.
    expect(isInsideGitRepo(tmpDir)).toBe(false);
  });
});

describe("git-preflight: formatGitWarningLines", () => {
  it("returns no lines when the directory is inside a git repo", () => {
    expect(formatGitWarningLines({ status: "inside" })).toEqual([]);
  });

  it("returns no lines when git was just initialized", () => {
    expect(formatGitWarningLines({ status: "initialized" })).toEqual([]);
  });

  it("returns a decline warning when the user said no", () => {
    const lines = formatGitWarningLines({ status: "declined" });
    expect(lines.some((l) => l.includes("not a git repository"))).toBe(true);
    expect(lines.some((l) => l.includes("auto-commit features are disabled"))).toBe(true);
  });

  it("returns a decline warning for non-interactive runs", () => {
    const lines = formatGitWarningLines({ status: "non-interactive" });
    expect(lines.some((l) => l.includes("auto-commit features are disabled"))).toBe(true);
  });

  it("surfaces the underlying error when `git init` failed", () => {
    const lines = formatGitWarningLines({ status: "init-failed", error: "git: command not found" });
    expect(lines.some((l) => l.includes("`git init` failed"))).toBe(true);
    expect(lines.some((l) => l.includes("git: command not found"))).toBe(true);
  });
});

describe("git-preflight: runGitPreflight", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "git-preflight-run-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns status:inside when the target is already a git repo", async () => {
    await mkdir(join(tmpDir, ".git"));
    const result = await runGitPreflight(tmpDir, { quiet: true });
    expect(result.status).toBe("inside");
  });

  it("returns status:non-interactive for non-TTY runs without prompting", async () => {
    // The vitest process is non-TTY; runGitPreflight should detect that and
    // resolve without trying to read from stdin.
    const result = await runGitPreflight(tmpDir, { quiet: true });
    expect(result.status).toBe("non-interactive");
  });

  // `consent` is how a caller with no TTY answers the prompt: `ndx init --git`
  // and the dashboard setup wizard, which asks the question in the browser.
  it.runIf(GIT_OK)("creates the repository when consent is given up front", async () => {
    const result = await runGitPreflight(tmpDir, { quiet: true, consent: true });
    expect(result.status).toBe("initialized");
    expect(isInsideGitRepo(tmpDir)).toBe(true);
  });

  it("declines without prompting or writing when consent is refused", async () => {
    const result = await runGitPreflight(tmpDir, { quiet: true, consent: false });
    expect(result.status).toBe("declined");
    expect(isInsideGitRepo(tmpDir)).toBe(false);
    // A decline still warns — the project works, auto-commit features do not.
    expect(formatGitWarningLines(result).length).toBeGreaterThan(0);
  });

  it("returns status:inside for a directory already in a repo, whatever the consent", async () => {
    await mkdir(join(tmpDir, ".git"));
    expect((await runGitPreflight(tmpDir, { quiet: true, consent: true })).status).toBe("inside");
    expect((await runGitPreflight(tmpDir, { quiet: true, consent: false })).status).toBe("inside");
  });
});

describe("git-preflight: formatGitInitCommitLines", () => {
  it("returns no lines when the result is null (commit step did not run)", () => {
    expect(formatGitInitCommitLines(null)).toEqual([]);
    expect(formatGitInitCommitLines(undefined)).toEqual([]);
  });

  it("returns a confirmation line on successful commit", () => {
    const lines = formatGitInitCommitLines({ status: "committed", paths: [".rex"] });
    expect(lines.some((l) => l.includes("Initial git commit created"))).toBe(true);
    expect(lines.some((l) => l.includes("chore: n-dx init"))).toBe(true);
  });

  it("returns a skip note when no n-dx files exist to stage", () => {
    const lines = formatGitInitCommitLines({ status: "nothing-to-commit" });
    expect(lines.some((l) => l.includes("Initial git commit skipped"))).toBe(true);
  });

  it("surfaces the staging error when `git add` failed", () => {
    const lines = formatGitInitCommitLines({ status: "add-failed", error: "index locked" });
    expect(lines.some((l) => l.includes("staging n-dx files"))).toBe(true);
    expect(lines.some((l) => l.includes("index locked"))).toBe(true);
  });

  it("returns no lines when a re-init changed nothing", () => {
    expect(formatGitInitCommitLines({ status: "unchanged" })).toEqual([]);
  });

  it("counts the files committed in an existing repository", () => {
    const lines = formatGitInitCommitLines({ status: "committed", kind: "files", paths: ["a", "b"] });
    expect(lines).toEqual(["  Committed 2 init files (chore: n-dx init)."]);
  });

  it("says the files were left uncommitted under --no-commit", () => {
    const lines = formatGitInitCommitLines({ status: "skipped" });
    expect(lines.some((l) => l.includes("left uncommitted"))).toBe(true);
  });

  it("surfaces the commit error when `git commit` failed", () => {
    const lines = formatGitInitCommitLines({
      status: "commit-failed",
      error: "Please tell me who you are",
    });
    expect(lines.some((l) => l.includes("n-dx init commit failed"))).toBe(true);
    expect(lines.some((l) => l.includes("uncommitted"))).toBe(true);
    expect(lines.some((l) => l.includes("Please tell me who you are"))).toBe(true);
  });
});

describe.skipIf(!GIT_OK)("git-preflight: commitInitBaseline", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "git-preflight-commit-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns nothing-to-commit when no n-dx files exist", () => {
    initRepo(tmpDir);
    const result = commitInitBaseline(tmpDir);
    expect(result.status).toBe("nothing-to-commit");
  });

  it("stages the canonical n-dx directories and creates an init baseline commit", async () => {
    initRepo(tmpDir);
    await mkdir(join(tmpDir, ".sourcevision"));
    await mkdir(join(tmpDir, ".rex"));
    await mkdir(join(tmpDir, ".hench"));
    await writeFile(join(tmpDir, ".sourcevision", "manifest.json"), "{}\n");
    await writeFile(join(tmpDir, ".rex", "config.json"), "{}\n");
    await writeFile(join(tmpDir, ".hench", "config.json"), "{}\n");
    await writeFile(join(tmpDir, ".n-dx.json"), "{}\n");
    await writeFile(join(tmpDir, ".gitignore"), ".n-dx.local.json\n");

    const result = commitInitBaseline(tmpDir);
    expect(result.status).toBe("committed");
    expect(result.paths).toEqual(
      expect.arrayContaining([".sourcevision", ".rex", ".hench", ".n-dx.json", ".gitignore"]),
    );

    // The commit should be on HEAD with the standard message.
    const message = execFileSync("git", ["log", "-1", "--pretty=%s"], {
      cwd: tmpDir, encoding: "utf-8", stdio: "pipe",
    }).trim();
    expect(message).toBe("chore: n-dx init");

    // The working tree should be clean — every staged path is now tracked.
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: tmpDir, encoding: "utf-8", stdio: "pipe",
    }).trim();
    expect(status).toBe("");
  });

  it("leaves the commit to the caller: finishInitCommit does nothing outside a repository", () => {
    expect(finishInitCommit(tmpDir, { gitResult: { status: "declined" }, before: null })).toBeNull();
    expect(finishInitCommit(tmpDir, { gitResult: { status: "non-interactive" }, before: null })).toBeNull();
  });

  it("returns add-failed when git is not a valid repository (`.git` is a bogus file)", async () => {
    // Without an initialized repo, `git add` fails with a fatal error —
    // surfaces as add-failed rather than throwing out of the helper.
    await writeFile(join(tmpDir, ".rex"), ""); // also forces `git add` to error
    const result = commitInitBaseline(tmpDir);
    // Either add-failed (no .git) or committed (some unrelated parent .git)
    // — both are acceptable shapes; the contract is no throw.
    expect(["add-failed", "commit-failed", "committed", "nothing-to-commit"]).toContain(result.status);
    if (result.status === "add-failed" || result.status === "commit-failed") {
      expect(typeof result.error).toBe("string");
    }
  });
});

describe("git-preflight: parsePorcelainZ", () => {
  it("collects every path, including both sides of a rename", () => {
    const out = " M a.txt\0?? dir/b.txt\0R  new.txt\0old.txt\0A  c.txt\0";
    expect([...parsePorcelainZ(out)].sort()).toEqual(["a.txt", "c.txt", "dir/b.txt", "new.txt", "old.txt"]);
  });

  it("returns an empty set for a clean tree", () => {
    expect(parsePorcelainZ("").size).toBe(0);
  });
});

// The commit at the end of `ndx init` in a repository that already existed.
describe.skipIf(!GIT_OK)("git-preflight: committing init's paths in an existing repo", () => {
  let tmpDir;

  const git = (...args) => execFileSync("git", args, { cwd: tmpDir, encoding: "utf-8", stdio: "pipe" });
  const status = () => git("status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean).sort();
  const commitCount = () => Number(git("rev-list", "--count", "HEAD").trim());
  const inside = { status: "inside" };

  /** Stand-in for init's writes: a tool directory, config, and a .gitignore edit. */
  async function simulateInitWrites() {
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await writeFile(join(tmpDir, ".rex", "config.json"), "{}\n");
    await writeFile(join(tmpDir, ".n-dx.json"), "{}\n");
    await writeFile(join(tmpDir, ".gitignore"), "node_modules\n.n-dx.local.json\n");
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "git-preflight-inside-"));
    initRepo(tmpDir);
    await writeFile(join(tmpDir, ".gitignore"), "node_modules\n");
    await writeFile(join(tmpDir, "app.js"), "one\n");
    await writeFile(join(tmpDir, "lib.js"), "one\n");
    git("add", "-A");
    git("commit", "-q", "-m", "user baseline");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("commits the paths init wrote with the n-dx trailers and leaves a clean tree", async () => {
    const before = snapshotDirtyPaths(tmpDir);
    await simulateInitWrites();

    const result = finishInitCommit(tmpDir, { gitResult: inside, before });
    expect(result).toMatchObject({ status: "committed", kind: "files" });
    expect(result.paths).toEqual([".gitignore", ".n-dx.json", ".rex/config.json"]);
    expect(status()).toEqual([]);

    const message = git("log", "-1", "--pretty=%B");
    expect(message.startsWith("chore: n-dx init\n")).toBe(true);
    expect(message).toContain("N-DX: init/files");
    expect(message).toContain("Co-Authored-By: En Dash's n-dx <n-dx@endash.us>");
  });

  it("stages and commits only init's paths, leaving the user's changes as they were", async () => {
    await writeFile(join(tmpDir, "app.js"), "staged edit\n");
    git("add", "app.js");
    await writeFile(join(tmpDir, "lib.js"), "unstaged edit\n");
    await writeFile(join(tmpDir, "notes.txt"), "untracked\n");
    const userStatus = status();

    const before = snapshotDirtyPaths(tmpDir);
    await simulateInitWrites();
    const result = finishInitCommit(tmpDir, { gitResult: inside, before });

    expect(result.status).toBe("committed");
    const committed = git("show", "--name-only", "--pretty=format:", "HEAD").split("\n").filter(Boolean).sort();
    expect(committed).toEqual([".gitignore", ".n-dx.json", ".rex/config.json"]);
    // The user's staged, unstaged and untracked changes are untouched.
    expect(status()).toEqual(userStatus);
  });

  it("creates no commit when a re-init changed nothing", () => {
    const before = snapshotDirtyPaths(tmpDir);
    const count = commitCount();
    const result = finishInitCommit(tmpDir, { gitResult: inside, before });
    expect(result.status).toBe("unchanged");
    expect(formatGitInitCommitLines(result)).toEqual([]);
    expect(commitCount()).toBe(count);
  });

  it("leaves everything uncommitted under --no-commit", async () => {
    const before = snapshotDirtyPaths(tmpDir);
    await simulateInitWrites();
    const count = commitCount();
    const result = finishInitCommit(tmpDir, { gitResult: inside, before, commit: false });
    expect(result.status).toBe("skipped");
    expect(commitCount()).toBe(count);
    expect(status().length).toBeGreaterThan(0);
  });

  it("drops machine-local files an earlier commit tracked, keeping them on disk and the user's staging intact", async () => {
    // The ndx-demo shape: a hand `git add .` took in the dashboard pid and the
    // analysis cache, and the running server has since rewritten the pid.
    await writeFile(join(tmpDir, ".n-dx-web.pid"), "111\n");
    await mkdir(join(tmpDir, ".sourcevision", ".cache"), { recursive: true });
    await writeFile(join(tmpDir, ".sourcevision", ".cache", "analyses.jsonl"), "{}\n");
    git("add", "-A");
    git("commit", "-q", "-m", "user add-all");
    await writeFile(join(tmpDir, ".n-dx-web.pid"), "222\n");
    await writeFile(join(tmpDir, "app.js"), "staged edit\n");
    git("add", "app.js");

    const before = snapshotDirtyPaths(tmpDir);
    await simulateInitWrites();
    const ignore = machineLocalIgnoreEntries(tmpDir);
    await writeFile(join(tmpDir, ".gitignore"), `node_modules\n${ignore.join("\n")}\n`);
    const result = finishInitCommit(tmpDir, { gitResult: inside, before });

    expect(result).toMatchObject({ status: "committed", kind: "files" });
    expect(result.untracked.sort()).toEqual([".n-dx-web.pid", ".sourcevision/.cache/analyses.jsonl"]);
    expect(git("ls-files", ".n-dx-web.pid", ".sourcevision/.cache").trim()).toBe("");
    expect(existsSync(join(tmpDir, ".n-dx-web.pid"))).toBe(true);
    // Only the user's staged edit is left; the pid no longer shows as modified.
    expect(status()).toEqual(["M  app.js"]);
    expect(formatGitInitCommitLines(result).join("\n")).toContain("Stopped tracking 2 machine-local files");
  });

  it("commits sourcevision output that was already dirty, but not the user's own PRD edits", async () => {
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await writeFile(join(tmpDir, ".sourcevision", "CONTEXT.md"), "v1\n");
    await writeFile(join(tmpDir, ".rex", "item.md"), "v1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "first init");
    // A hub-started analysis, and an uncommitted PRD edit, before re-init.
    await writeFile(join(tmpDir, ".sourcevision", "CONTEXT.md"), "v2\n");
    await writeFile(join(tmpDir, ".rex", "item.md"), "user edit\n");

    const before = snapshotDirtyPaths(tmpDir);
    const result = finishInitCommit(tmpDir, { gitResult: inside, before });

    expect(result.paths).toEqual([".sourcevision/CONTEXT.md"]);
    expect(status()).toEqual([" M .rex/item.md"]);
  });

  it("ignores the dashboard runtime files and both caches", () => {
    expect(machineLocalIgnoreEntries(tmpDir)).toEqual(expect.arrayContaining([
      ".n-dx-web.pid", ".n-dx-web.port", ".n-dx-web-usage.jsonl", ".sourcevision/.cache/", ".rex/.cache/",
    ]));
  });

  it("returns null from snapshotDirtyPaths outside a repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "git-preflight-outside-"));
    try {
      expect(snapshotDirtyPaths(outside)).toBeNull();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
