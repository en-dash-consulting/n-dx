/**
 * The exit tracer records which file a dying worker ran and who called exit.
 *
 * Runs a nested vitest on a fixture whose test passes and whose worker then
 * calls process.exit(1): the shape of the "Worker exited unexpectedly" reports
 * the tracer exists to explain.
 *
 * @see tests/setup-exit-trace.js
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dirname, "../..");
const FIXTURE = join(ROOT, "tests/fixtures/exit-trace");
const VITEST = join(ROOT, "node_modules/vitest/vitest.mjs");

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function runFixture(traceDir) {
  const env = { ...process.env };
  delete env.NDX_TEST_EXIT_TRACE;
  if (traceDir) env.NDX_TEST_EXIT_TRACE = traceDir;
  return spawnSync(process.execPath, [VITEST, "run", "--config", join(FIXTURE, "vitest.config.mjs")], {
    cwd: FIXTURE,
    env,
    encoding: "utf-8",
    windowsHide: true,
  });
}

describe("setup-exit-trace", () => {
  it("names the file and the caller of process.exit when tracing is on", () => {
    const base = mkdtempSync(join(tmpdir(), "exit-trace-"));
    dirs.push(base);
    const traceDir = join(base, "trace");
    runFixture(traceDir);

    const logs = readdirSync(traceDir).filter((f) => /^worker-\d+\.log$/.test(f));
    const text = logs.map((f) => readFileSync(join(traceDir, f), "utf-8")).join("\n");
    expect(text).toMatch(/ file .*dies\.fixture\.js/);
    expect(text).toMatch(/ process\.exit code=1\nError: exit called from[\s\S]*dies\.fixture\.js/);
    // vitest 5 turns the call into an error naming the file, which the
    // monitor sees without changing it. A bare "Worker exited unexpectedly"
    // therefore did not come from process.exit inside a test.
    expect(text).toMatch(/ uncaught uncaughtException\nError: process\.exit unexpectedly called/);
  }, 60_000);

  // vitest prints the stack of the process.exit error it raises. With tracing
  // on, that stack passes through the tracer's wrapper; off, the wrapper must
  // not be installed at all, so no frame names the tracer.
  // vitest prints frames as "❯ process.exit <path>:<line>:<col>".
  const WRAPPER_FRAME = /process\.exit \S*setup-exit-trace\.js:\d+/;

  it("installs its hooks when tracing is on", () => {
    const base = mkdtempSync(join(tmpdir(), "exit-trace-on-"));
    dirs.push(base);
    const run = runFixture(join(base, "trace"));
    expect(`${run.stdout}${run.stderr}`).toMatch(WRAPPER_FRAME);
  }, 60_000);

  it("installs nothing when tracing is off", () => {
    const run = runFixture(undefined);
    const output = `${run.stdout}${run.stderr}`;
    // The fixture did run and die the way the on case does…
    expect(output).toMatch(/process\.exit unexpectedly called/);
    // …but process.exit was vitest's own, not the tracer's.
    expect(output).not.toMatch(WRAPPER_FRAME);
  }, 60_000);
});
