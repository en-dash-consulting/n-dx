/**
 * `hench.testGate.rerunCommand` through finalizeRun: an unattended gate that
 * fails re-runs only the suites on its `test-gate: failed-suites=` line, once.
 *
 * The gate is a real shell script outside the repository that keeps its call
 * log in a temp file, so it can fail on the first call and pass (or fail) on
 * the second. finalizeRun, the resolver and runTestGate are real.
 */

import { describe, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import type { HenchConfig, RunRecord } from "../../src/schema/index.js";
import { finalizeRun } from "../../src/agent/lifecycle/shared.js";
import { initGitFixtureRepo, cleanupProjectDir } from "../helpers/index.js";
import { itNeedsPosixShell } from "../helpers/posix-shell.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

const REX_FAILURE = " FAIL  tests/unit/store.test.ts > store > saves under the lock";
const ROOT_FAILURE = " FAIL  tests/integration/scheduler-startup.test.js > scheduler > starts";

let projectDir: string;
let gateDir: string;
let henchDir: string;
let baseline: string;
let logged: string[];
let originalIsTTY: boolean | undefined;

interface FakeGate {
  /** What the second call does. */
  second: "pass" | "fail";
  /** The first call's failed-suites line; null prints none. */
  failedLine?: string | null;
  /** Seconds the first call sleeps before exiting (to force a timeout). */
  firstSleep?: number;
}

/** Write the fake gate; returns the command that runs it. */
async function fakeGate({ second, failedLine = "test-gate: failed-suites=rex,root", firstSleep }: FakeGate): Promise<string> {
  const calls = join(gateDir, "calls.log");
  const script = [
    "#!/bin/sh",
    `echo "args:$*" >> "${calls}"`,
    `n=$(wc -l < "${calls}" | tr -d ' ')`,
    `echo "test-gate: selected-suites=\${1:-hench,rex,root}"`,
    `if [ "$n" -eq 1 ]; then`,
    `  echo "──────── @n-dx/hench ────────"`,
    `  echo " PASS  tests/unit/a.test.ts"`,
    `  echo "──────── @n-dx/rex ────────"`,
    `  echo "${REX_FAILURE}"`,
    `  echo "──────── root (tests/**) ────────"`,
    `  echo "${ROOT_FAILURE}"`,
    `  echo "──────── summary ────────"`,
    `  echo "  FAIL  @n-dx/rex"`,
    ...(failedLine ? [`  echo "${failedLine}"`] : []),
    ...(firstSleep ? [`  sleep ${firstSleep}`] : []),
    "  exit 1",
    "fi",
    second === "pass"
      ? "exit 0"
      : `echo " FAIL  tests/unit/store.test.ts > store > still broken"; echo "test-gate: failed-suites=$1"; exit 1`,
    "",
  ].join("\n");
  const path = join(gateDir, "gate.sh");
  await writeFile(path, script);
  return `sh "${path}"`;
}

async function calls(): Promise<string[]> {
  const path = join(gateDir, "calls.log");
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf-8")).split("\n").filter(Boolean);
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "hench-gate-rerun-"));
  gateDir = await mkdtemp(join(tmpdir(), "hench-gate-rerun-script-"));
  henchDir = join(projectDir, ".hench");
  await mkdir(join(henchDir, "runs"), { recursive: true });
  await initGitFixtureRepo(projectDir);
  await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n");
  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "baseline");
  baseline = git(projectDir, "rev-parse", "HEAD").trim();
  await writeFile(join(projectDir, "src.ts"), "export const a = 2;\n");
  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "feat: the work");

  originalIsTTY = process.stdin.isTTY;
  logged = [];
  const capture = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
  await cleanupProjectDir(projectDir);
  await rm(gateDir, { recursive: true, force: true });
});

function buildRun(): RunRecord {
  return {
    id: randomUUID(),
    taskId: "t",
    taskTitle: "t",
    startedAt: new Date().toISOString(),
    status: "completed",
    turns: 1,
    tokenUsage: { input: 1, output: 1 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
  };
}

const RERUN = (path: string) => `${path} {suites}`;

function configWith(command: string, rerunCommand?: string, extra: Partial<HenchConfig> = {}): HenchConfig {
  return { ...DEFAULT_HENCH_CONFIG(), testGate: { command, ...(rerunCommand ? { rerunCommand } : {}) }, ...extra };
}

async function finalize(config: HenchConfig, mode: { autonomous?: boolean; yes?: boolean } = { autonomous: true }) {
  const run = buildRun();
  await finalizeRun({
    run, henchDir, projectDir, config, ...mode, rollbackOnFailure: false, startingHead: baseline,
  });
  return run;
}

describe("hench.testGate.rerunCommand", () => {
  itNeedsPosixShell("passes the gate when the failed suites pass on the re-run, recording the flakes", async () => {
    const gate = await fakeGate({ second: "pass" });
    const run = await finalize(configWith(gate, RERUN(gate)));

    expect(run.status).toBe("completed");
    expect(run.error).toBeUndefined();
    expect(run.testGate?.passed).toBe(true);
    expect(run.testGate?.command).toBe(`${gate} rex,root`);
    expect(run.testGate?.flakyRerun).toEqual([
      { suite: "rex", firstFailure: REX_FAILURE.trim() },
      { suite: "root", firstFailure: ROOT_FAILURE.trim() },
    ]);
    expect(run.testGate?.firstAttempt).toMatchObject({ command: gate, failedSuites: ["rex", "root"] });
    expect(run.testGate?.firstAttempt?.totalDurationMs).toEqual(expect.any(Number));
    expect(run.testGate?.rerun).toMatchObject({ suites: ["rex", "root"], passed: true });
    // The gate's own selection survives the re-run, which only saw the failed labels.
    expect(run.testGate?.suites).toEqual(["hench", "rex", "root"]);
    expect(run.testGate?.firstAttempt?.suites).toEqual(["hench", "rex", "root"]);
    expect(logged.join("\n")).toMatch(/Flaky: rex, root failed, then passed on a re-run/);
  });

  itNeedsPosixShell("fails the run when the suites fail again, saying so", async () => {
    const gate = await fakeGate({ second: "fail" });
    const run = await finalize(configWith(gate, RERUN(gate)));

    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/rex, root failed again on a re-run/);
    expect(run.testGate?.passed).toBe(false);
    expect(run.testGate?.command).toBe(gate);
    expect(run.testGate?.rerun).toMatchObject({ suites: ["rex", "root"], passed: false });
    expect(run.testGate?.suites).toEqual(["hench", "rex", "root"]);
    expect(run.testGate?.rerun?.totalDurationMs).toEqual(expect.any(Number));
    expect(run.testGate?.flakyRerun).toBeUndefined();
    // Diagnostics come from the re-run.
    expect(run.diagnostics?.testGateOutputTail).toContain("still broken");
    expect(run.diagnostics?.testGateFailureDigest).toContain("still broken");
    expect(await calls()).toHaveLength(2);
  });

  itNeedsPosixShell("passes the re-run exactly the failed labels", async () => {
    const gate = await fakeGate({ second: "pass" });
    await finalize(configWith(gate, RERUN(gate)));

    expect(await calls()).toEqual(["args:", "args:rex,root"]);
  });

  itNeedsPosixShell("does not re-run without rerunCommand", async () => {
    const gate = await fakeGate({ second: "pass" });
    const run = await finalize(configWith(gate));

    expect(run.status).toBe("failed");
    expect(run.error).not.toMatch(/re-run/);
    expect(run.testGate).not.toHaveProperty("rerun");
    expect(run.testGate).not.toHaveProperty("rerunSkipped");
    expect(await calls()).toHaveLength(1);
  });

  itNeedsPosixShell("does not re-run on the interactive TTY path", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const gate = await fakeGate({ second: "pass" });
    // The operator answers [a]bort at the rerun/abort/skip prompt.
    const answer = setInterval(() => process.stdin.emit("data", "a\n"), 50);
    let run: RunRecord;
    try {
      run = await finalize(configWith(gate, RERUN(gate)), { autonomous: false, yes: false });
    } finally {
      clearInterval(answer);
    }

    expect(run.status).toBe("failed");
    expect(run.testGate).not.toHaveProperty("rerun");
    expect(await calls()).toHaveLength(1);
  });

  itNeedsPosixShell("does not re-run a gate that timed out", async () => {
    const gate = await fakeGate({ second: "pass", firstSleep: 10 });
    const run = await finalize(configWith(gate, RERUN(gate), { fullTestTimeoutMs: 1000 }));

    expect(run.status).toBe("failed");
    expect(run.testGate?.error).toMatch(/did not finish within 1s/);
    expect(run.testGate).not.toHaveProperty("rerun");
    expect(await calls()).toHaveLength(1);
  });

  itNeedsPosixShell("does not re-run when the output has no failed-suites line", async () => {
    const gate = await fakeGate({ second: "pass", failedLine: null });
    const run = await finalize(configWith(gate, RERUN(gate)));

    expect(run.status).toBe("failed");
    expect(run.testGate).not.toHaveProperty("rerun");
    expect(run.testGate?.rerunSkipped).toMatch(/no failed suites/);
    expect(await calls()).toHaveLength(1);
  });

  itNeedsPosixShell("does not re-run a label unsafe for the shell", async () => {
    const gate = await fakeGate({ second: "pass", failedLine: "test-gate: failed-suites=rex,a;b" });
    const run = await finalize(configWith(gate, RERUN(gate)));

    expect(run.status).toBe("failed");
    expect(run.testGate?.rerunSkipped).toMatch(/"a;b" is not safe/);
    expect(await calls()).toHaveLength(1);
  });
});
