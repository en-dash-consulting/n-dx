/**
 * The failing test's name survives in the stored gate output (0.7.1 PR C2).
 *
 * Run 6eacca42's gate failed on `tests/e2e/cli-config.test.js`, yet the run
 * record's `failureOutput`, `outputTail` and `diagnostics.testGateOutputTail`
 * held 23 KB of stderr from passing web tests and no FAIL line. The gate
 * combines stdout and then stderr, and keeps the last 200 lines — so a long
 * stderr stream pushes out everything stdout said, the suite summary included.
 * The shape below is that run's: the failure and the summary on stdout, then
 * hundreds of lines of noise on stderr.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { extractFailureDigest } from "../../../src/tools/test-runner.js";
import { initConfig } from "../../../src/store/config.js";
import type { RunRecord } from "../../../src/schema/index.js";
import { commitGitFixtureBaseline } from "../../helpers/index.js";

const FAIL_FILE = "tests/e2e/cli-config.test.js";
const FAIL_TEST = "ndx config > rejects an unknown key";

const SUMMARY = [
  "──────── summary ────────",
  "",
  "  FAIL  root (tests/**)  → .test-logs/root-tests.log",
  "  PASS  @n-dx/core",
  "  PASS  @n-dx/hench",
  "  PASS  @n-dx/llm-client",
  "  PASS  @n-dx/rex",
  "  PASS  @n-dx/sourcevision",
  "  PASS  @n-dx/web",
  "",
  "6/7 suites passed — failed: root (tests/**)",
];

/** stdout: the root suite fails, then every package passes; the summary last. */
const STDOUT = [
  "──────── root (tests/**) ────────",
  "",
  ` \u001b[31mFAIL\u001b[39m  ${FAIL_FILE} > ${FAIL_TEST}`,
  "AssertionError: expected 0 to be 1 // Object.is equality",
  "",
  "- Expected",
  "+ Received",
  "",
  "- 1",
  "+ 0",
  "",
  ` ❯ ${FAIL_FILE}:88:24`,
  "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯",
  "",
  " Test Files  1 failed | 212 passed (213)",
  "      Tests  1 failed | 1904 passed (1905)",
  "",
  "──────── @n-dx/web ────────",
  " Test Files  380 passed (380)",
  "",
  ...SUMMARY,
].join("\n");

/** stderr: far more than the tail's 200 lines of passing-test noise. */
const STDERR = Array.from({ length: 600 }, (_, i) =>
  i % 3 === 0
    ? "stderr | tests/unit/viewer/polling-state.test.ts > dispose > survives a throwing listener"
    : `Error: dispose boom ${i}\n    at Object.<anonymous> (polling-state.ts:${i}:1)`,
).join("\n");

describe("extractFailureDigest", () => {
  it("names the failing file and test, with its assertion block", () => {
    const digest = extractFailureDigest(`${STDOUT}\n${STDERR}`)!;
    expect(digest).toContain(`FAIL  ${FAIL_FILE} > ${FAIL_TEST}`);
    expect(digest).toContain("AssertionError: expected 0 to be 1");
    expect(digest).toContain(`❯ ${FAIL_FILE}:88:24`);
    // Stops at vitest's rule rather than running on into the next suite.
    expect(digest).not.toContain("@n-dx/web ────");
    expect(digest).not.toMatch(/\u001b\[/);
  });

  it("keeps the per-suite summary whole", () => {
    const digest = extractFailureDigest(`${STDOUT}\n${STDERR}`)!;
    const summaryAt = digest.indexOf("Suite summary:");
    expect(summaryAt).toBeGreaterThan(-1);
    const summaryBlock = digest.slice(summaryAt);
    for (const line of SUMMARY.filter((l) => l.trim())) {
      expect(summaryBlock).toContain(line.trim());
    }
  });

  it("reports failing counts, not passing ones", () => {
    const digest = extractFailureDigest(STDOUT)!;
    expect(digest).toContain("Test Files  1 failed | 212 passed (213)");
    expect(digest).not.toContain("380 passed");
  });

  it("is undefined when there is no FAIL line and no summary", () => {
    expect(extractFailureDigest(STDERR.replace(/Error: /g, "note: "))).toBeUndefined();
    expect(extractFailureDigest("running packages/rex…\nstill running…")).toBeUndefined();
  });
});

describe("runTestGate with a FAIL line followed by more than a tail of stderr", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-gate-digest-"));
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock("../../../src/process/exec.js");
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(projectDir, { recursive: true, force: true });
  });

  async function gateWith(result: { stdout: string; stderr: string; exitCode: number | null; error: Error | null }) {
    vi.doMock("../../../src/process/exec.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../../src/process/exec.js")>()),
      execShellCmd: async () => ({ ...result, launched: true }),
    }));
    return import("../../../src/tools/test-runner.js");
  }

  it("names the failing test in failureDigest and failureOutput, where the tail cannot", async () => {
    const { runTestGate } = await gateWith({ stdout: STDOUT, stderr: STDERR, exitCode: 1, error: new Error("exit 1") });
    const gate = await runTestGate({ projectDir, filesChanged: ["src/a.ts"], testCommand: "npm run test" });

    expect(gate.passed).toBe(false);
    // The defect, pinned: the last 200 lines are all stderr noise.
    expect(gate.outputTail).not.toContain(FAIL_FILE);
    expect(gate.failureDigest).toContain(`${FAIL_FILE} > ${FAIL_TEST}`);
    expect(gate.packages[0].failureOutput).toContain(`${FAIL_FILE} > ${FAIL_TEST}`);
    expect(gate.packages[0].failureOutput).toContain("6/7 suites passed — failed: root (tests/**)");
  });

  it("keeps the tail as today when the output has no FAIL line (a timeout)", async () => {
    const noise = Array.from({ length: 250 }, (_, i) => `running shard ${i}`).join("\n");
    const { runTestGate } = await gateWith({ stdout: noise, stderr: "", exitCode: null, error: new Error("ETIMEDOUT") });
    const gate = await runTestGate({ projectDir, filesChanged: ["src/a.ts"], testCommand: "npm run test", timeout: 60_000 });

    expect(gate.failureDigest).toBeUndefined();
    expect(gate.outputTail?.split("\n")).toHaveLength(200);
    expect(gate.outputTail).toContain("running shard 249");
    expect(gate.packages[0].failureOutput).toContain("running shard 249");
    expect(gate.packages[0].failureOutput).not.toContain("Failing tests:");
  });

  it("the run record and the printed gate failure name the failing test", async () => {
    await gateWith({ stdout: STDOUT, stderr: STDERR, exitCode: 1, error: new Error("exit 1") });
    const { finalizeRun } = await import("../../../src/agent/lifecycle/shared.js");

    const henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "f", scripts: { test: "vitest run" } }));
    await writeFile(join(projectDir, ".gitignore"), ".hench/\n.run-logs/\n");
    // The gate runs only when git reports a changed file since the start.
    const startingHead = commitGitFixtureBaseline(projectDir);
    await writeFile(join(projectDir, "changed.ts"), "export const x = 1;\n");

    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => { printed.push(String(line)); });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const run: RunRecord = {
      id: randomUUID(), taskId: "t", taskTitle: "T", startedAt: new Date().toISOString(), status: "completed",
      turns: 1, tokenUsage: { input: 1, output: 1 }, turnTokenUsage: [], toolCalls: [], model: "m",
    };
    await finalizeRun({ run, henchDir, projectDir, autonomous: true, rollbackOnFailure: false, startingHead });

    expect(run.status).toBe("failed");
    expect(run.testGate?.failureDigest).toContain(`${FAIL_FILE} > ${FAIL_TEST}`);
    expect(run.testGate?.packages[0].failureOutput).toContain(FAIL_FILE);
    expect(run.diagnostics?.testGateFailureDigest).toContain(`${FAIL_FILE} > ${FAIL_TEST}`);
    expect(printed.join("\n")).toContain(`${FAIL_FILE} > ${FAIL_TEST}`);
  });
});
