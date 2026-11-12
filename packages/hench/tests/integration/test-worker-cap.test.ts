import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPostTaskTests, runTestGate } from "../../src/tools/test-runner.js";
import { validateCompletion } from "../../src/validation/completion.js";
import { GuardRails } from "../../src/guard/index.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import { TEST_MAX_WORKERS_ENV } from "../../src/process/test-workers.js";
import { describeNeedsPosixShell } from "../helpers/posix-shell.js";

/**
 * `hench.testGate.maxWorkers` reaches every test command hench runs as
 * `NDX_TEST_MAX_WORKERS`, and an unset cap leaves the environment alone.
 *
 * Each command is a probe that exits 0 only when it sees the expected value.
 * The cap used is 3, so a parent that already exports a cap (a hench gate
 * running this suite exports 2) cannot make the "set" cases pass; the "unset"
 * cases expect whatever the parent has, read and never written.
 */

const CAP = 3;
const INHERITED = process.env[TEST_MAX_WORKERS_ENV];

function probe(expected: string | undefined): string {
  const want = expected === undefined ? "undefined" : `'${expected}'`;
  return `node -e "process.exit(process.env.${TEST_MAX_WORKERS_ENV} === ${want} ? 0 : 4)"`;
}

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hench-worker-cap-"));
  mkdirSync(join(projectDir, "src"));
  writeFileSync(join(projectDir, "src", "a.ts"), "export const a = 1;\n");
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describeNeedsPosixShell("test commands receive the worker cap", () => {
  it("the test gate", async () => {
    const result = await runTestGate({
      projectDir, filesChanged: ["src/a.ts"], testCommand: probe(String(CAP)), testMaxWorkers: CAP,
    });
    expect(result.passed).toBe(true);
  });

  it("the test gate's re-run", async () => {
    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/a.ts"],
      testCommand: `node -e "console.log('test-gate: failed-suites=root'); process.exit(1)"`,
      rerunTemplate: `${probe(String(CAP))} {suites}`,
      testMaxWorkers: CAP,
    });
    expect(result.rerun?.passed).toBe(true);
  });

  it("post-task tests", async () => {
    const result = await runPostTaskTests({
      projectDir, filesChanged: ["src/a.ts"], testCommand: probe(String(CAP)), testMaxWorkers: CAP,
    });
    expect(result.passed).toBe(true);
  });

  it("the completion check's test run", async () => {
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: projectDir });
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "init");
    writeFileSync(join(projectDir, "src", "a.ts"), "export const a = 2;\n");
    const result = await validateCompletion(projectDir, { testCommand: probe(String(CAP)), testMaxWorkers: CAP });
    expect(result.testsPassed).toBe(true);
  });

  it("an unset cap changes nothing", async () => {
    const gate = await runTestGate({ projectDir, filesChanged: ["src/a.ts"], testCommand: probe(INHERITED) });
    const post = await runPostTaskTests({ projectDir, filesChanged: ["src/a.ts"], testCommand: probe(INHERITED) });
    expect(gate.passed).toBe(true);
    expect(post.passed).toBe(true);
  });
});

describe("the agent session's shell receives the worker cap", () => {
  it("is set on the guard's child environment", () => {
    const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard, {
      env: { PATH: "/bin" }, sandbox: null, testMaxWorkers: CAP,
    });
    expect(guard.childEnv[TEST_MAX_WORKERS_ENV]).toBe(String(CAP));
  });

  it("is absent when unset", () => {
    const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard, { env: { PATH: "/bin" }, sandbox: null });
    expect(guard.childEnv).not.toHaveProperty(TEST_MAX_WORKERS_ENV);
  });
});
