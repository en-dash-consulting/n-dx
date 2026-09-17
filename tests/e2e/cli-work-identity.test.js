/**
 * The identity line `ndx work` prints before handing over to the agent.
 *
 * A run is the most expensive thing the CLI starts and the hardest to
 * attribute afterwards — the run record says what happened but not which
 * install produced it. These drive the real CLI against real temp projects,
 * covering what the unit tests (tests/unit/install-identity.test.js) stub
 * out: that the version and cli path come from this checkout, that the branch
 * is the *project's* rather than the install's, and that the modes whose
 * output is parsed stay silent.
 *
 * `--dry-run` throughout: it reaches the same code path without spawning a
 * vendor CLI or spending a token.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CLI_PATH,
  createTmpDir,
  removeTmpDir,
  runResult,
  setupFullProject,
} from "./e2e-helpers.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "packages/core/package.json"), "utf-8"));
const CORE_CLI = join(REPO_ROOT, "packages", "core", "cli.js");
/** The middot the line joins its fields with. */
const SEP = "·";

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** The identity line out of a run's stdout, or null when it printed none. */
function identityLineOf(stdout) {
  const lines = stdout.split("\n").filter((line) => line.startsWith("ndx "));
  return lines.length === 0 ? null : lines[0];
}

describe("ndx work identity line", () => {
  let repo;
  let plain;

  beforeAll(async () => {
    repo = await createTmpDir("ndx-work-identity-repo-");
    await setupFullProject(repo);
    git(repo, "init", "--quiet", "--initial-branch=main");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "init");
    git(repo, "checkout", "--quiet", "-b", "feature/identity");

    plain = await createTmpDir("ndx-work-identity-plain-");
    await setupFullProject(plain);
  }, 120_000);

  afterAll(async () => {
    for (const dir of [repo, plain]) if (dir) await removeTmpDir(dir);
  });

  it("prints version, cli path, project dir and branch, first and once", () => {
    const result = runResult(["work", "--dry-run", repo]);
    expect(result.code, result.stderr).toBe(0);

    const lines = result.stdout.split("\n");
    const line = lines[0];
    expect(line).toBe(`ndx ${version} ${SEP} ${CORE_CLI} ${SEP} ${repo} ${SEP} feature/identity`);

    // Once, not per turn: the dashboard shows the last line of the child's
    // stdout as its live status hint, so a repeat would overwrite real
    // progress with a banner.
    expect(lines.filter((l) => l === line)).toHaveLength(1);
  });

  it("names the project's branch, not the branch of the checkout n-dx runs from", () => {
    // This CLI runs from the n-dx checkout, which is on its own branch; the
    // line must report the temp repository's.
    const line = identityLineOf(runResult(["work", "--dry-run", repo]).stdout);
    expect(line).toContain("feature/identity");

    const ndxBranch = git(REPO_ROOT, "rev-parse", "--abbrev-ref", "HEAD").trim();
    if (ndxBranch !== "feature/identity") expect(line).not.toContain(ndxBranch);
  });

  it("drops the branch segment for a project that is not a git working tree", () => {
    const line = identityLineOf(runResult(["work", "--dry-run", plain]).stdout);
    expect(line).toBe(`ndx ${version} ${SEP} ${CORE_CLI} ${SEP} ${plain}`);
  });

  it("stays out of output that is parsed rather than read", () => {
    for (const flag of ["--format=json", "--quiet", "-q"]) {
      const { stdout } = runResult(["work", "--dry-run", flag, repo]);
      expect(identityLineOf(stdout), `${flag} printed an identity line`).toBeNull();
    }
  });

  it("reports the same install `ndx which` does", () => {
    const line = identityLineOf(runResult(["work", "--dry-run", repo]).stdout);
    const which = JSON.parse(runResult(["which", "--json", "--quiet", repo]).stdout);
    expect(line).toContain(`ndx ${which.version} `);
    expect(line).toContain(which.cliPath);
    expect(CLI_PATH).toBe(which.cliPath);
  });
});
