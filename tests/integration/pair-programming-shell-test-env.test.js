/**
 * The reviewer's shell test command runs with a filtered environment.
 *
 * `runShellTestCommand` spawns the project's test command with `shell: true`.
 * It must never hand the child the raw parent environment: the project's
 * `hench.guard.env` policy applies (its `allow` entries are how tests get the
 * variables they need), without a vendor CLI's authentication exceptions.
 * When that policy cannot be loaded — which is also what sends
 * `runCrossVendorReview` to this fallback — the default deny policy applies
 * and the result says so. Assertions are made in the real child process.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runShellTestCommand,
  runCrossVendorReview,
  formatReviewBanner,
} from "../../packages/core/pair-programming.js";

const FIXTURE_ENV = {
  NDX_REVIEW_FIXTURE_SECRET: "fixture-secret",
  NDX_REVIEW_FIXTURE_ALLOWED_TOKEN: "fixture-allowed",
  ANTHROPIC_API_KEY: "fixture-anthropic",
  OPENAI_API_KEY: "fixture-openai",
};

let tmpDir;
let savedEnv;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ndx-pair-shell-env-"));
  savedEnv = Object.fromEntries(Object.keys(FIXTURE_ENV).map((name) => [name, process.env[name]]));
  Object.assign(process.env, FIXTURE_ENV);
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeProjectConfig(config) {
  writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify(config), "utf-8");
}

/** A test command that prints which fixture variables reached it. */
function probeCommand() {
  const probe = join(tmpDir, "probe.js");
  writeFileSync(
    probe,
    `const names = ${JSON.stringify(Object.keys(FIXTURE_ENV))};\n`
      + "console.log('PROBE ' + JSON.stringify(names.filter((n) => n in process.env)));\n",
    "utf-8",
  );
  return `"${process.execPath}" "${probe}"`;
}

function probedNames(output) {
  const line = output.split(/\r?\n/).find((l) => l.startsWith("PROBE "));
  expect(line, output).toBeDefined();
  return JSON.parse(line.slice("PROBE ".length));
}

/** Executable reviewer stub that answers `--version`, so the reviewer counts as available. */
function writeMockReviewer() {
  const jsPath = join(tmpDir, "mock-reviewer.js");
  writeFileSync(
    jsPath,
    "#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('mock 1.0.0'); process.exit(0); }\nprocess.exit(0);\n",
    "utf-8",
  );
  if (process.platform === "win32") {
    const cmdPath = join(tmpDir, "mock-reviewer.cmd");
    writeFileSync(cmdPath, `@"${process.execPath}" "${jsPath}" %*\r\n`, "utf-8");
    return cmdPath;
  }
  chmodSync(jsPath, 0o755);
  return jsPath;
}

describe("runShellTestCommand environment", () => {
  it("applies the project's guard.env policy without vendor authentication exceptions", async () => {
    writeProjectConfig({ hench: { guard: { env: { allow: ["NDX_REVIEW_FIXTURE_ALLOWED_TOKEN"] } } } });

    const result = await runShellTestCommand(probeCommand(), tmpDir);

    expect(result.exitCode).toBe(0);
    expect(probedNames(result.output)).toEqual(["NDX_REVIEW_FIXTURE_ALLOWED_TOKEN"]);
    expect(result.envWarning).toBeUndefined();
  });

  it("falls back to the default deny policy, and says so, when the project policy is invalid", async () => {
    writeProjectConfig({ hench: { guard: { env: { deny: [42], allow: ["NDX_REVIEW_FIXTURE_ALLOWED_TOKEN"] } } } });

    const result = await runShellTestCommand(probeCommand(), tmpDir);

    expect(result.exitCode).toBe(0);
    expect(probedNames(result.output)).toEqual([]);
    expect(result.envWarning).toContain("guard.env policy could not be loaded");
  });
});

describe("runCrossVendorReview shell-test fallback environment", () => {
  it("runs the fallback under the default filter when the project policy cannot be resolved", async () => {
    // deny: [42] fails the reviewer's env resolution (spawnError) and the shell test env alike.
    writeProjectConfig({
      llm: { claude: { cli_path: writeMockReviewer() } },
      hench: { guard: { env: { deny: [42] } } },
    });

    const result = await runCrossVendorReview({ dir: tmpDir, reviewer: "claude", testCommand: probeCommand() });

    expect(result).toMatchObject({ mode: "shell-test-only", skipped: false, passed: true });
    expect(probedNames(result.output)).toEqual([]);
    expect(result.envWarning).toContain("guard.env policy could not be loaded");
    expect(formatReviewBanner("claude", result)).toContain("guard.env policy could not be loaded");
  });
});
