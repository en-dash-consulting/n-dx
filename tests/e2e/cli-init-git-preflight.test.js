/**
 * Regression tests for the git-repository preflight in `ndx init`.
 *
 * Pins:
 *   1. When the target directory is not inside a git working tree and the
 *      run is non-interactive, init completes successfully and the summary
 *      surfaces a persistent warning about disabled auto-commits.
 *   2. When the target directory IS inside a git working tree, no warning
 *      is emitted — the check is silent.
 *
 * The interactive prompt path is not exercised here (execFileSync gives no
 * TTY); the non-interactive branch is the contract for CI / scripted use.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, chmod, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const isWin = process.platform === "win32";
const PATH_SEP = isWin ? ";" : ":";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

async function writeFakeBinary(filePath, { stdout = "", exitCode = 0 } = {}) {
  if (isWin) {
    const cmdPath = filePath + ".cmd";
    const lines = ["@echo off"];
    if (stdout) lines.push(`echo ${stdout}`);
    if (exitCode !== 0) lines.push(`exit /b ${exitCode}`);
    await writeFile(cmdPath, lines.join("\r\n") + "\r\n");
    return cmdPath;
  }
  const lines = ["#!/bin/sh"];
  if (stdout) lines.push(`echo '${stdout}'`);
  if (exitCode !== 0) lines.push(`exit ${exitCode}`);
  await writeFile(filePath, lines.join("\n") + "\n");
  await chmod(filePath, 0o755);
  return filePath;
}

function run(args, opts = {}) {
  return execFileSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 25000,
    stdio: "pipe",
    ...opts,
  });
}

describe("ndx init: git preflight", () => {
  let tmpDir;
  let binDir;
  let initEnv;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-git-"));
    binDir = await mkdtemp(join(tmpdir(), "ndx-init-git-bin-"));
    await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });
    initEnv = {
      ...process.env,
      PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
      CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  it("emits a persistent auto-commit warning when the target is not a git repo (non-interactive)", () => {
    const output = run(["init", "--provider=codex", "--no-claude", tmpDir], { env: initEnv });
    expect(output).toContain("not a git repository");
    expect(output).toContain("auto-commit features are disabled");
    // The init still completes — surfaces of the recap remain present.
    expect(output).toContain("LLM configuration");
    // No `.git` was created because the user could not be prompted.
    expect(existsSync(join(tmpDir, ".git"))).toBe(false);
  });

  it("stays silent about git when the target is already inside a git working tree", async () => {
    // Marker file: a `.git` directory is sufficient — the preflight is a pure
    // filesystem walk, no git binary spawn needed.
    await mkdir(join(tmpDir, ".git"));

    const output = run(["init", "--provider=codex", "--no-claude", tmpDir], { env: initEnv });
    expect(output).not.toContain("not a git repository");
    expect(output).not.toContain("auto-commit features are disabled");
    expect(output).toContain("LLM configuration");
    // No baseline commit attempt for pre-existing repos — the commit step
    // only runs when this `ndx init` invocation created the repo itself.
    expect(output).not.toContain("Initial git commit created");
    expect(output).not.toContain("Initial git commit skipped");
  });

  it("does not attempt the baseline commit in non-interactive runs (no consent)", () => {
    // Without a TTY, runGitPreflight returns `non-interactive` and the
    // baseline commit step is skipped entirely.  Pin the absence so a future
    // refactor doesn't accidentally trigger a spawn against `git commit`
    // outside an init'd repo.
    const output = run(["init", "--provider=codex", "--no-claude", tmpDir], { env: initEnv });
    expect(output).not.toContain("Initial git commit created");
    expect(output).not.toContain("Initial git commit skipped");
    expect(output).not.toContain("creating the initial n-dx commit failed");
  });
});
