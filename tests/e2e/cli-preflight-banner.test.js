/**
 * End-to-end: the preflight banner reaches stderr, respects its suppression
 * flags, and never touches the stdout a machine reader is parsing.
 *
 * `ndx recommend` is the command under test throughout because it is the one
 * declared command that makes no LLM calls and no network request — it can be
 * run for real, repeatedly, in a temp directory, with a deterministic result.
 * The banner and summary code paths it exercises are the same ones `analyze`
 * and `plan` go through; what differs between them is only the declaration.
 *
 * The gate's deciding input is whether stdout is a terminal and the suite has
 * no pty, so `NDX_PREFLIGHT=always` stands in for one — the same technique
 * `cli-tty-color.test.js` uses with `FORCE_COLOR`. The gate's own precedence
 * rules are unit-tested in tests/unit/command-effects.test.js.
 *
 * @see tests/wall-clock-assertion-inventory.md — the one elapsed-time bound here
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CLI_PATH,
  createTmpDir,
  removeTmpDir,
  setupFullProject,
  withSandboxedClaudeConfig,
  DEFAULT_TIMEOUT,
} from "./e2e-helpers.js";

let dir;

/**
 * Run `ndx` and capture **both** streams.
 *
 * Deliberately not e2e-helpers' `runResult`: that one is built on
 * `execFileSync`, which returns only stdout and therefore reports `stderr: ""`
 * on a run that succeeds. Every assertion in this file is about stderr on a
 * successful run, so it needs `spawnSync`.
 */
function runResult(args, opts = {}) {
  const res = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT,
    ...withSandboxedClaudeConfig(opts),
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status };
}

/**
 * Environment for one run. `NDX_PREFLIGHT_PAUSE_MS: "0"` unless a test is
 * specifically about the pause — every other case only cares about the text.
 */
function env(overrides = {}) {
  return {
    ...process.env,
    NO_COLOR: "1",
    NDX_PREFLIGHT_PAUSE_MS: "0",
    // The parent runner may be inside CI; these tests decide the gate
    // themselves through NDX_PREFLIGHT and must not inherit that.
    CI: "",
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await createTmpDir("ndx-preflight-");
  await setupFullProject(dir);
  // Real findings, so `recommend --format=json` emits a substantial document
  // rather than an empty one — an empty-vs-empty comparison would pass without
  // proving anything (TESTING.md, Family 4: assume the vacuous pass is there).
  await writeFile(
    join(dir, ".sourcevision", "zones.json"),
    JSON.stringify({
      zones: [],
      crossings: [],
      unzoned: [],
      summary: { totalZones: 0, totalFiles: 0 },
      findings: [
        { type: "anti-pattern", severity: "warning", category: "structural", message: "Circular import between a and b", scope: "core" },
        { type: "suggestion", severity: "critical", category: "cohesion", message: "Zone core has low cohesion", scope: "core" },
      ],
    }),
  );
});

afterEach(async () => {
  await removeTmpDir(dir);
});

describe("preflight banner", () => {
  it("prints the declared effects to stderr when shown", () => {
    const { stderr, code } = runResult(["recommend", dir], { env: env({ NDX_PREFLIGHT: "always" }) });

    expect(code).toBe(0);
    expect(stderr).toContain("ndx recommend");
    expect(stderr).toContain("reads");
    expect(stderr).toContain("writes");
    // recommend is declared as making no model calls; the banner must say so,
    // because "this one is free" is the most useful thing it can tell you.
    expect(stderr).toContain("no model calls");
    expect(stderr).toContain("Ctrl-C");
  });

  it("names this project's real paths, never the declaration's layout tokens", () => {
    // Declarations write `{rex}/prd_tree/`; the CLI must expand them before
    // printing, or the banner names a folder nobody has and the run summary
    // checks it — reporting a written file as untouched.
    const { stderr } = runResult(["recommend", dir], { env: env({ NDX_PREFLIGHT: "always" }) });
    expect(stderr).toContain(".rex/prd_tree/");
    expect(stderr).not.toMatch(/\{(rex|hench|sourcevision|config)\}/);
  });

  it("does not print the banner when stdout is a pipe", () => {
    // The autonomous case: `ndx work` spawns its children with piped stdio.
    const { stderr } = runResult(["recommend", dir], { env: env() });
    expect(stderr).not.toContain("Ctrl-C");
  });

  it("does not print the banner under --yes, even when asked to always show it", () => {
    const { stderr } = runResult(["recommend", "--yes", dir], {
      env: env({ NDX_PREFLIGHT: "always" }),
    });
    expect(stderr).not.toContain("Ctrl-C");
  });

  it("does not print the banner under --quiet", () => {
    const { stderr } = runResult(["recommend", "--quiet", dir], {
      env: env({ NDX_PREFLIGHT: "always" }),
    });
    expect(stderr).not.toContain("Ctrl-C");
  });

  it("does not print the banner in CI", () => {
    const { stderr } = runResult(["recommend", dir], { env: env({ CI: "true" }) });
    expect(stderr).not.toContain("Ctrl-C");
  });

  it("does not forward --yes to the spawned CLI", () => {
    // --yes answers the orchestrator's pause; no child declares it. Forwarding
    // a flag nobody reads is how an unrecognized-flag error gets invented later.
    const { code, stderr } = runResult(["recommend", "--yes", dir], { env: env() });
    expect(code).toBe(0);
    expect(stderr).not.toMatch(/unknown|unrecognized/i);
  });
});

describe("run summary", () => {
  it("closes with what ran and what to do next", () => {
    const { stderr } = runResult(["recommend", dir], { env: env({ NDX_PREFLIGHT: "always" }) });

    expect(stderr).toContain("wrote");
    expect(stderr).toContain("no model calls");
    expect(stderr).toContain("next");
    expect(stderr).toContain("ndx work");
  });

  it("is suppressed alongside the banner", () => {
    const { stderr } = runResult(["recommend", "--yes", dir], { env: env() });
    expect(stderr).not.toContain("ndx work");
  });
});

/**
 * `rex recommend` mints a fresh UUID per recommendation on every invocation, so
 * two runs are never byte-identical for a reason that has nothing to do with
 * the banner. Blanking the ids leaves everything the banner could have
 * disturbed — ordering, whitespace, framing, every other field — under
 * comparison.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

describe("--format=json output is unchanged by the banner", () => {
  it("emits identical stdout whether or not the banner would show", () => {
    // Two guarantees at once: --format=json suppresses the banner outright, and
    // the banner writes to stderr regardless — so neither could reach stdout.
    const withBanner = runResult(["recommend", "--format=json", dir], {
      env: env({ NDX_PREFLIGHT: "always" }),
    });
    const withoutBanner = runResult(["recommend", "--format=json", dir], {
      env: env({ NDX_PREFLIGHT: "never" }),
    });

    expect(withBanner.code).toBe(0);
    // Not a vacuous comparison of two empty strings: the fixture has findings,
    // so this document is substantial.
    expect(JSON.parse(withBanner.stdout).length).toBeGreaterThan(0);
    expect(withBanner.stdout.replace(UUID, "<id>"))
      .toBe(withoutBanner.stdout.replace(UUID, "<id>"));
  });

  it("keeps the banner off stderr too under --format=json", () => {
    const { stderr } = runResult(["recommend", "--format=json", dir], {
      env: env({ NDX_PREFLIGHT: "always" }),
    });
    expect(stderr).not.toContain("Ctrl-C");
  });
});

describe("the pause", () => {
  /**
   * Lower bound only, and deliberately so.
   *
   * This is the one clock reading in the file. It is safe under load in a way
   * an upper bound would not be: ambient load can only make a run take *longer*
   * than the pause it contains, never shorter, so a busy machine cannot turn
   * this red. Its failure mode is the real one — a regression that drops the
   * `await` and starts the command immediately.
   *
   * 600 ms of pause against a 400 ms floor: enough headroom for timer
   * granularity while staying far below the 600 ms a dropped pause would not
   * reach. Measured with the pause removed, the same run returns in ~1.2 s of
   * process startup with 0 ms attributable to the pause.
   */
  const PAUSE_MS = 600;
  const PAUSE_FLOOR_MS = 400;

  it("waits before starting the command", () => {
    const startedAt = Date.now();
    const { stderr } = runResult(["recommend", dir], {
      env: env({ NDX_PREFLIGHT: "always", NDX_PREFLIGHT_PAUSE_MS: String(PAUSE_MS) }),
      timeout: DEFAULT_TIMEOUT,
    });
    const elapsedMs = Date.now() - startedAt;

    // State the precondition rather than inferring it: without the banner there
    // is no pause to measure, and the bound below would hold vacuously on
    // process startup alone.
    expect(stderr).toContain("Ctrl-C");
    expect(elapsedMs).toBeGreaterThan(PAUSE_FLOOR_MS);
  });

  // There is no separate "does not pause when suppressed" case: the pause and
  // the banner are the same branch, and the suppression cases above already
  // assert the banner is absent.
});
