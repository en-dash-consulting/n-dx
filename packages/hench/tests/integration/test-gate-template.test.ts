/**
 * `hench.testGate.command` through finalizeRun: the template's `{base}` is
 * filled with the run's start commit, the real gate runs the result, and the
 * run record carries the base and the suites the command said it selected.
 *
 * Only the gate's command is fake (a shell echo); finalizeRun, the resolver and
 * runTestGate are real, against a real git repository.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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

const TEMPLATE = `echo "gate ran since {base}"; echo "test-gate: selected-suites=hench,rex"`;

let projectDir: string;
let henchDir: string;
let baseline: string;
let logged: string[];

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "hench-gate-template-"));
  henchDir = join(projectDir, ".hench");
  await mkdir(join(henchDir, "runs"), { recursive: true });
  await initGitFixtureRepo(projectDir);
  // What the untemplated gate would run: a command that records its own use.
  await writeFile(
    join(projectDir, "package.json"),
    JSON.stringify({ name: "p", scripts: { test: "echo untemplated gate" } }),
  );
  await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n");
  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "baseline");
  baseline = git(projectDir, "rev-parse", "HEAD").trim();
  // The executor's own commit: changed since `baseline`, nothing left dirty.
  await writeFile(join(projectDir, "src.ts"), "export const a = 2;\n");
  git(projectDir, "add", "-A");
  git(projectDir, "commit", "-q", "-m", "feat: the work");

  logged = [];
  const capture = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
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

function configWith(testGate?: HenchConfig["testGate"], fullTestCommand?: string): HenchConfig {
  return { ...DEFAULT_HENCH_CONFIG(), ...(testGate ? { testGate } : {}), ...(fullTestCommand ? { fullTestCommand } : {}) };
}

describe("hench.testGate.command", () => {
  itNeedsPosixShell("runs the template with {base} filled and records base and suites", async () => {
    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, config: configWith({ command: TEMPLATE }, "echo fullTestCommand"),
      autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    expect(run.error).toBeUndefined();
    expect(run.status).toBe("completed");
    expect(run.testGate?.ran).toBe(true);
    expect(run.testGate?.command).toBe(TEMPLATE.replaceAll("{base}", baseline));
    expect(run.testGate?.base).toBe(baseline);
    expect(run.testGate?.suites).toEqual(["hench", "rex"]);
    expect(run.testGate?.scopeFallback).toBeUndefined();

    const out = logged.join("\n");
    expect(out).toContain(`Test gate: affected since ${baseline.slice(0, 7)} → ${run.testGate?.command}`);
    expect(out).toContain("Test gate selected: hench, rex");
  });

  itNeedsPosixShell("prefers gateBase over startingHead", async () => {
    git(projectDir, "commit", "-q", "--allow-empty", "-m", "later");
    const later = git(projectDir, "rev-parse", "HEAD").trim();
    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, config: configWith({ command: TEMPLATE }),
      autonomous: true, rollbackOnFailure: false, startingHead: later, gateBase: baseline,
    });

    expect(run.testGate?.base).toBe(baseline);
  });

  itNeedsPosixShell("falls back to the untemplated command, says so, and records scopeFallback when no base is known", async () => {
    // No start commit means changes are read against HEAD, so leave one dirty
    // file for the gate to have something to cover.
    await writeFile(join(projectDir, "src.ts"), "export const a = 3;\n");
    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, config: configWith({ command: TEMPLATE }),
      autonomous: true, rollbackOnFailure: false,
    });

    expect(run.testGate?.ran).toBe(true);
    expect(run.testGate?.command).toBe("npm run test");
    expect(run.testGate?.base).toBeUndefined();
    expect(run.testGate?.suites).toBeUndefined();
    expect(run.testGate?.scopeFallback).toMatch(/start commit is unknown/);
    expect(logged.join("\n")).toMatch(/hench\.testGate\.command not used \(.*unknown\)/);
  });

  itNeedsPosixShell("leaves the record untouched when no template is configured", async () => {
    const run = buildRun();
    await finalizeRun({
      run, henchDir, projectDir, config: configWith(undefined, "echo fullTestCommand"),
      autonomous: true, rollbackOnFailure: false, startingHead: baseline,
    });

    expect(run.testGate?.command).toBe("echo fullTestCommand");
    expect(run.testGate).not.toHaveProperty("base");
    expect(run.testGate).not.toHaveProperty("suites");
    expect(run.testGate).not.toHaveProperty("scopeFallback");
  });
});
