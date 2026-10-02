/**
 * `ndx work --task=<id> --resolve <dir>` through the real CLI.
 *
 * The dashboard parses this command's stdout, so what is pinned here is the
 * orchestration layer's half of the contract: stdout is exactly one JSON
 * object (no identity line, no vendor-gate error), the process exits 0 even
 * when the report carries refusals — an unset vendor reaches hench as the
 * `vendor-unset` refusal instead of stopping `ndx work` — and nothing in the
 * project changes. The resolution itself is covered in
 * packages/hench/tests/integration/run-resolve.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTmpDir, removeTmpDir, runResult, setupFullProject } from "./e2e-helpers.js";

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

describe("ndx work --resolve", () => {
  let repo;

  beforeAll(async () => {
    repo = await createTmpDir("ndx-work-resolve-");
    await setupFullProject(repo);
    git(repo, "init", "--quiet", "--initial-branch=main");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "init");
  }, 120_000);

  afterAll(async () => {
    if (repo) await removeTmpDir(repo);
  });

  it("prints only the JSON report and exits 0 when the vendor is unset", () => {
    const status = git(repo, "status", "--porcelain");
    const result = runResult(["work", "--task=task-2", "--resolve", repo]);

    expect(result.code, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.task).toMatchObject({ id: "task-2", status: "pending" });
    expect(report.refusals.map((r) => r.code)).toContain("vendor-unset");
    expect(report.command).toBe(`ndx work --task=task-2 --auto ${repo}`);
    expect(git(repo, "status", "--porcelain")).toBe(status);
  });

  it("forwards run flags to hench as a real run would", () => {
    writeFileSync(
      join(repo, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", claude: { cli_path: process.execPath } } }),
    );
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "vendor");

    const result = runResult(["work", "--task=task-2", "--resolve", "--model=opus", "--max-turns=9", repo]);
    expect(result.code, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.refusals).toEqual([]);
    expect(report.resolved.vendor).toEqual({ value: "claude", source: "llm.vendor" });
    expect(report.resolved.model.source).toBe("cli-flag");
    expect(report.resolved.maxTurns).toEqual({ value: 9, source: "cli-flag" });
  });

  it("reports a completed task as a refusal, still exiting 0", () => {
    const result = runResult(["work", "--task=task-1", "--resolve", repo]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).refusals.map((r) => r.code)).toEqual(["not-actionable"]);
  });

  it("refuses --resolve without --task", () => {
    const result = runResult(["work", "--resolve", repo]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/--resolve requires --task/);
  });
});
