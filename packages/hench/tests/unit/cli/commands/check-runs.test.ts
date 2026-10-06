/**
 * `hench check-runs` — audits runs recorded as running across every worktree
 * of the repository, and with `--fix` ends the ones nothing is executing.
 *
 * The verdict rules are covered by `tests/unit/process/run-liveness.test.ts`;
 * these tests cover what the command reads, what it writes, and when it
 * refuses to write.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";
import { cmdCheckRuns, RUN_END_ERROR_PREFIX } from "../../../../src/cli/commands/check-runs.js";

/** A pid that belonged to a process that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  if (!child.pid) throw new Error("could not spawn a throwaway process");
  return child.pid;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("hench check-runs", () => {
  let base: string;
  let main: string;
  let feature: string;
  let out: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  const runsDirOf = (root: string) => join(root, ".hench", "runs");

  async function writeRun(
    root: string,
    id: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const startedAt = new Date(Date.now() - 50 * 3_600_000).toISOString();
    await writeFile(
      join(runsDirOf(root), `${id}.json`),
      JSON.stringify({
        id,
        taskId: `task-${id}`,
        taskTitle: `Task ${id}`,
        startedAt,
        lastActivityAt: startedAt,
        status: "running",
        host: hostname(),
        turns: 2,
        tokenUsage: { input: 10, output: 5 },
        toolCalls: [],
        model: "claude-opus-5",
        ...overrides,
      }, null, 2),
    );
  }

  async function readRun(root: string, id: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(runsDirOf(root), `${id}.json`), "utf-8"));
  }

  const printed = () => out.join("\n");

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "hench-check-runs-")));
    main = join(base, "main");
    feature = join(base, "feature");
    await mkdir(main);
    git(main, "init", "-q", "-b", "main");
    git(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    git(main, "worktree", "add", "-q", "-b", "feature", feature);
    await mkdir(runsDirOf(main), { recursive: true });
    await mkdir(runsDirOf(feature), { recursive: true });

    out = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(" "));
    });
    process.exitCode = undefined;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    process.exitCode = undefined;
    await rm(base, { recursive: true, force: true });
  });

  it("reports when nothing is recorded as running", async () => {
    await cmdCheckRuns(main, {});
    expect(printed()).toContain("No runs are recorded as running");
  });

  it("lists running records from every worktree with verdict and reason", async () => {
    await writeRun(main, "aaaaaaaa", { pid: deadPid() });
    await writeRun(feature, "bbbbbbbb", { pid: process.pid, lastActivityAt: new Date().toISOString() });
    await writeRun(feature, "cccccccc", { status: "completed" });

    await cmdCheckRuns(main, { format: "json" });
    const report = JSON.parse(printed());

    expect(report.liveness).toMatchObject({ total: 2, live: 1, orphaned: 1 });
    const byPath = new Map(report.worktrees.map((w: { path: string }) => [w.path, w]));
    expect(byPath.get(main)).toMatchObject({
      branch: "main",
      runs: [{ id: "aaaaaaaa", liveness: "orphaned", canEnd: true, ended: false }],
    });
    expect(byPath.get(feature)).toMatchObject({
      branch: "feature",
      runs: [{ id: "bbbbbbbb", liveness: "live", pid: process.pid }],
    });
    expect((byPath.get(main) as { runs: Array<{ reason: string }> }).runs[0]!.reason).toContain("no longer running");
  });

  it("groups the text report by worktree", async () => {
    await writeRun(main, "aaaaaaaa", { pid: deadPid() });
    await writeRun(feature, "bbbbbbbb", { pid: process.pid, lastActivityAt: new Date().toISOString() });

    await cmdCheckRuns(main, {});
    const text = printed();

    expect(text).toContain(`main (main) — ${main}`);
    expect(text).toContain(`feature (feature) — ${feature}`);
    expect(text).toContain("aaaaaaaa");
    expect(text).toContain("bbbbbbbb");
    expect(text).toContain("Re-run with --fix");
  });

  it("--worktree narrows the audit to the worktree containing the path", async () => {
    await writeRun(main, "aaaaaaaa", { pid: deadPid() });
    await writeRun(feature, "bbbbbbbb", { pid: deadPid() });

    await cmdCheckRuns(main, { format: "json", worktree: feature });
    const report = JSON.parse(printed());

    expect(report.worktrees).toHaveLength(1);
    expect(report.worktrees[0].path).toBe(feature);
    expect(report.liveness.total).toBe(1);
  });

  it("--worktree rejects a path outside the repository", async () => {
    await expect(cmdCheckRuns(main, { worktree: tmpdir() })).rejects.toThrow(/No worktree/);
  });

  it("does not write without --fix", async () => {
    await writeRun(main, "aaaaaaaa", { pid: deadPid() });
    await cmdCheckRuns(main, {});
    expect((await readRun(main, "aaaaaaaa")).status).toBe("running");
  });

  it("--fix ends only orphaned runs, in every worktree, with the shared prefix", async () => {
    await writeRun(main, "aaaaaaaa", { pid: deadPid() });
    await writeRun(feature, "bbbbbbbb", { pid: deadPid() });
    await writeRun(feature, "livelive", { pid: process.pid, lastActivityAt: new Date().toISOString() });
    await writeRun(feature, "foreign1", { host: "some-other-machine" });
    await writeRun(feature, "unknown1", { pid: process.pid }); // alive pid, stale heartbeat

    await cmdCheckRuns(main, { fix: "true" });

    for (const [root, id] of [[main, "aaaaaaaa"], [feature, "bbbbbbbb"]] as const) {
      const run = await readRun(root, id);
      expect(run.status).toBe("failed");
      expect(run.error).toMatch(new RegExp(`^${RUN_END_ERROR_PREFIX}: `));
      expect(run.finishedAt).toBeTruthy();
    }
    expect(RUN_END_ERROR_PREFIX).toBe("Ended by audit reconciliation");
    for (const id of ["livelive", "foreign1", "unknown1"]) {
      expect((await readRun(feature, id)).status).toBe("running");
    }
  });

  it("--include-unknown also ends runs that could not be confirmed, never live or foreign", async () => {
    await writeRun(feature, "livelive", { pid: process.pid, lastActivityAt: new Date().toISOString() });
    await writeRun(feature, "foreign1", { host: "some-other-machine" });
    await writeRun(feature, "unknown1", { pid: process.pid });

    await cmdCheckRuns(main, { fix: "true", "include-unknown": "true" });

    expect((await readRun(feature, "unknown1")).status).toBe("failed");
    expect((await readRun(feature, "livelive")).status).toBe("running");
    expect((await readRun(feature, "foreign1")).status).toBe("running");
  });

  it("--strict exits 1 when any running record is not live", async () => {
    await writeRun(feature, "bbbbbbbb", { pid: deadPid() });
    await cmdCheckRuns(main, { strict: "true" });
    expect(process.exitCode).toBe(1);
  });

  it("--strict exits 0 when every running record is live", async () => {
    await writeRun(feature, "livelive", { pid: process.pid, lastActivityAt: new Date().toISOString() });
    await cmdCheckRuns(main, { strict: "true" });
    expect(process.exitCode).toBeUndefined();
  });

  it("--strict --fix exits 0 once the dead runs are ended", async () => {
    await writeRun(main, "aaaaaaaa", { pid: deadPid() });
    await cmdCheckRuns(main, { strict: "true", fix: "true" });
    expect(process.exitCode).toBeUndefined();
  });

  it("audits the directory alone outside a git repository", async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), "hench-check-runs-plain-")));
    try {
      await mkdir(runsDirOf(plain), { recursive: true });
      await writeRun(plain, "aaaaaaaa", { pid: deadPid() });
      await cmdCheckRuns(plain, { format: "json" });
      const report = JSON.parse(printed());
      expect(report.worktrees).toHaveLength(1);
      expect(report.liveness.orphaned).toBe(1);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});
