/**
 * `ndx migrate-layout` through the real CLI.
 *
 * The unit suite pins the git mechanics against a synthetic fixture; this one
 * answers the question that only a spawned CLI can: does the *rest of n-dx*
 * still see the same project afterwards. `ndx status` and `rex validate` are
 * the two readers whose answers must be byte-identical across the move — if
 * either changes, the migration rearranged something it was only supposed to
 * relocate.
 *
 * @see packages/core/migrate-layout.js
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run, runResult, setupFullProject } from "./e2e-helpers.js";

function gitAvailable() {
  try {
    execFileSync("git", ["--version"], { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const GIT_OK = gitAvailable();

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf-8", timeout: 15_000 });
}

describe("ndx migrate-layout", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-e2e-migrate-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("documents itself in the command surface", () => {
    expect(run(["--help"])).toContain("migrate-layout");
    const help = run(["migrate-layout", "--help"]);
    expect(help).toContain("--dry-run");
    expect(help).toContain("--no-commit");
  });

  it("reports the moves without making them under --dry-run", async () => {
    await setupFullProject(dir);

    const result = runResult(["migrate-layout", "--dry-run", dir]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(".rex");
    expect(result.stdout).toContain(".ndx/rex");
    expect(existsSync(join(dir, ".ndx"))).toBe(false);
    expect(existsSync(join(dir, ".rex"))).toBe(true);
  }, 60_000);

  it.skipIf(!GIT_OK)("leaves ndx status and rex validate saying exactly what they said before", async () => {
    await setupFullProject(dir);
    git(["init", "-q"], dir);
    git(["config", "user.email", "ndx-test@example.com"], dir);
    git(["config", "user.name", "ndx test"], dir);
    git(["config", "commit.gpgsign", "false"], dir);
    await writeFile(join(dir, ".gitignore"), ".rex/execution-log*.jsonl\n.hench/runs/\n");

    // Take the readings first, then commit. Reading the PRD is not a read-only
    // act on a project this shape — rex folds a legacy `prd.json` into the
    // folder tree on first load — and the migration refuses to commit over
    // uncommitted work, which is the behaviour under test two assertions down.
    const statusBefore = runResult(["status", dir]);
    const validateBefore = runResult(["validate", dir]);

    git(["add", "-A"], dir);
    git(["commit", "-q", "-m", "baseline"], dir);

    const migrate = runResult(["migrate-layout", dir]);
    expect(migrate.code, migrate.stdout + migrate.stderr).toBe(0);
    expect(existsSync(join(dir, ".ndx", "rex", "config.json"))).toBe(true);

    // The two readers that matter, unchanged. Both are spawned fresh, so each
    // resolves the layout for itself — this is the check that the container is
    // the whole mechanism and nothing needed to be told where to look.
    const statusAfter = runResult(["status", dir]);
    expect(statusAfter.code).toBe(statusBefore.code);
    expect(statusAfter.stdout).toBe(statusBefore.stdout);

    const validateAfter = runResult(["validate", dir]);
    expect(validateAfter.code).toBe(validateBefore.code);
    expect(validateAfter.stdout).toBe(validateBefore.stdout);

    // The ignore patterns followed the files they name.
    expect(readFileSync(join(dir, ".gitignore"), "utf-8"))
      .toContain(".ndx/rex/execution-log*.jsonl");

    // A second run changes nothing, including the commit history.
    const head = git(["rev-parse", "HEAD"], dir).trim();
    const second = runResult(["migrate-layout", dir]);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("Already on the .ndx/ layout");
    expect(git(["rev-parse", "HEAD"], dir).trim()).toBe(head);
    expect(git(["status", "--porcelain"], dir).trim()).toBe("");
  }, 180_000);
});
