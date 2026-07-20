/**
 * E2E tests for `ndx auth` — on-demand credential verification.
 *
 * The command re-runs the vendor auth preflight (same one as
 * `ndx config llm.vendor`) and reports pass/fail. Tests use a fake vendor
 * binary so no real CLI or network is touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

const isWin = process.platform === "win32";

/**
 * Create a platform-appropriate fake CLI binary.
 * On Unix: shell script with chmod 755. On Windows: .cmd batch file.
 */
async function writeFakeBinary(filePath, { stdout = "", stderrLine = "", exitCode = 0 } = {}) {
  if (isWin) {
    const cmdPath = filePath + ".cmd";
    const lines = ["@echo off"];
    if (stderrLine) lines.push(`echo ${stderrLine} 1>&2`);
    if (stdout) lines.push(`echo ${stdout}`);
    if (exitCode !== 0) lines.push(`exit /b ${exitCode}`);
    await writeFile(cmdPath, lines.join("\r\n") + "\r\n");
    return cmdPath;
  }
  const lines = ["#!/bin/sh"];
  if (stderrLine) lines.push(`echo '${stderrLine}' 1>&2`);
  if (stdout) lines.push(`echo '${stdout}'`);
  if (exitCode !== 0) lines.push(`exit ${exitCode}`);
  await writeFile(filePath, lines.join("\n") + "\n");
  await chmod(filePath, 0o755);
  return filePath;
}

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

/** Run `ndx <args>` capturing stdout/stderr/status (never throws). */
function runNdx(args) {
  const res = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 15000,
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status };
}

/** Set a config value via `ndx config` (throws on failure). */
function setConfig(key, value, dir) {
  execFileSync("node", [CLI_PATH, "config", key, value, dir], {
    encoding: "utf-8",
    timeout: 10000,
  });
}

describe("ndx auth", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-auth-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 and reports vendor, model, and 'credentials valid' when the claude preflight passes", async () => {
    const fakeClaude = await writeFakeBinary(join(tmpDir, "fake-claude-ok"), {
      stdout: '{"result":"ok"}',
    });
    setConfig("llm.claude.cli_path", fakeClaude, tmpDir);

    const { stdout, status } = runNdx(["auth", tmpDir]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/credentials valid/i);
    expect(stdout).toContain("vendor: claude");
    expect(stdout).toMatch(/model: \S+/);
  });

  it("exits non-zero with the structured auth-failure guidance when claude credentials are rejected", async () => {
    const fakeClaude = await writeFakeBinary(join(tmpDir, "fake-claude-fail"), {
      stderrLine: "please login",
      exitCode: 9,
    });
    setConfig("llm.claude.cli_path", fakeClaude, tmpDir);

    const { stdout, stderr, status } = runNdx(["auth", tmpDir]);
    expect(status).not.toBe(0);
    expect(stdout).not.toMatch(/credentials valid/i);
    // Canonical, JSON-free guidance — same wording as the runtime error path.
    expect(stderr).toContain("Authentication failed for Claude");
    expect(stderr).toContain("Invalid or expired credentials");
    expect(stderr).toContain("claude logout && claude login");
    expect(stderr).toContain("Verify credentials: ndx auth");
    expect(stderr).not.toContain("Details:");
    expect(stderr).not.toMatch(/"result"|\{"/);
  });

  it("exits non-zero with codex guidance when the codex preflight fails", async () => {
    // Setting llm.vendor runs its own preflight, so start with a passing
    // fake binary, then overwrite it with a failing one and run `ndx auth`
    // — simulating credentials that expired after the vendor was selected.
    const basePath = join(tmpDir, "fake-codex");
    const fakeCodex = await writeFakeBinary(basePath, { stdout: "ok" });
    setConfig("llm.codex.cli_path", fakeCodex, tmpDir);
    setConfig("llm.vendor", "codex", tmpDir);
    await writeFakeBinary(basePath, { stderrLine: "not logged in", exitCode: 7 });

    const { stderr, status } = runNdx(["auth", tmpDir]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("Authentication failed for Codex");
    expect(stderr).toContain("codex logout && codex login");
    expect(stderr).toContain("Verify credentials: ndx auth");
  });

  it("appears in 'ndx --help' output", () => {
    const { stdout, status } = runNdx(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/auth \[dir\]\s+Verify LLM provider credentials/);
  });

  it("shows detailed help for 'ndx auth --help'", () => {
    const { stdout, status } = runNdx(["auth", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("verify LLM provider credentials");
    expect(stdout).toContain("ndx auth [dir]");
  });
});
