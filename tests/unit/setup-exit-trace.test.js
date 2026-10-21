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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

  it("writes nothing when tracing is off", () => {
    const base = mkdtempSync(join(tmpdir(), "exit-trace-off-"));
    dirs.push(base);
    runFixture(undefined);
    expect(existsSync(join(base, "trace"))).toBe(false);
    expect(readdirSync(base)).toEqual([]);
  }, 60_000);
});
