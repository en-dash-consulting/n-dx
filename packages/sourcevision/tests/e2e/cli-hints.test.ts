/**
 * Hint surfacing and follow-through regression tests for the sourcevision CLI.
 *
 * Each test pair verifies:
 *   (a) a mistyped command emits hint text referencing a valid sourcevision command
 *   (b) the hinted command itself exits 0 — confirming the hint is actionable
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");
const SMALL_FIXTURE = join(import.meta.dirname, "../fixtures/small-ts-project");
const UNKNOWN_COMMAND_CODE = "NDX_CLI_UNKNOWN_COMMAND";

// TESTING.md "Flake Resistance" Family 3 (subprocess guardrails too tight for
// a loaded machine): this is a hang-guardrail ceiling, not a latency SLA, so
// it scales with the same env-driven multiplier as elapsed-time budgets
// elsewhere in the suite rather than a hand-picked constant.
const BUDGET_MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20);

// Per-spawn kill guardrails, scaled by BUDGET_MULTIPLIER instead of a fixed
// constant (see the comment above) so a loaded machine grows the ceiling
// rather than getting its spawn killed mid-work. Two sizes: SPAWN_TIMEOUT for
// trivial commands (unknown-command hints, init, validate, --help), and
// larger ceilings for the heavier 'analyze' and 'serve --help' spawns,
// preserving their original relative sizing.
const SPAWN_TIMEOUT = 10_000 * BUDGET_MULTIPLIER;
const ANALYZE_SPAWN_TIMEOUT = 30_000 * BUDGET_MULTIPLIER;
const SERVE_HELP_SPAWN_TIMEOUT = 15_000 * BUDGET_MULTIPLIER;

// TESTING.md Family 3: "keep testTimeout above the spawn guardrail so a
// genuine hang surfaces as a precise spawn timeout instead of an opaque test
// timeout." Every it() below must set its own vitest-level timeout above
// whichever spawn guardrail(s) it uses, or vitest's own timeout fires first
// and hides the more precise signal.
const TEST_TIMEOUT_BUFFER = 5_000;

function runResult(
  args: string[],
  timeout = SPAWN_TIMEOUT,
): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout,
      stdio: "pipe",
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.status ?? 1 };
  }
}

describe("sourcevision CLI hint surfacing and follow-through", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-hints-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("typo-correction hints", () => {
    it(
      "hint text matches valid command: 'valdate' → 'validate'",
      () => {
        const { stderr, code } = runResult(["valdate"]);
        expect(code).toBe(1);
        expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
        expect(stderr).toContain("Did you mean");
        expect(stderr).toContain("validate");
      },
      SPAWN_TIMEOUT + TEST_TIMEOUT_BUFFER,
    );

    it(
      "follow-through: hinted 'validate' exits 0 after init",
      () => {
        // init creates manifest.json; validate checks all data files and skips
        // missing ones, so it exits 0 with only manifest present.
        const init = runResult(["init", tmpDir]);
        expect(init.code).toBe(0);
        const { code } = runResult(["validate", tmpDir]);
        expect(code).toBe(0);
      },
      // Two cold-start node spawns back to back, each guarded by
      // SPAWN_TIMEOUT. A hand-picked 15s cap measured 25.8s under a
      // concurrent `pnpm build` (2.4s isolated) — Family 3: the guardrail was
      // sized for an idle machine. Must stay above 2x SPAWN_TIMEOUT (worst
      // case: both spawns run to their own ceiling) or vitest's own timeout
      // would fire first and hide the more precise spawn-timeout signal.
      SPAWN_TIMEOUT * 2 + TEST_TIMEOUT_BUFFER,
    );

    it(
      "hint text matches valid command: 'analyzee' → 'analyze'",
      async () => {
        const { stderr, code } = runResult(["analyzee"]);
        expect(code).toBe(1);
        expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
        expect(stderr).toContain("Did you mean");
        expect(stderr).toContain("analyze");
      },
      SPAWN_TIMEOUT + TEST_TIMEOUT_BUFFER,
    );

    it(
      "follow-through: hinted 'analyze' exits 0 on small fixture",
      async () => {
        // Copy fixture to avoid writing .sourcevision/ into the source tree.
        await cp(SMALL_FIXTURE, tmpDir, { recursive: true });
        const { code } = runResult(["analyze", tmpDir, "--fast"], ANALYZE_SPAWN_TIMEOUT);
        expect(code).toBe(0);
      },
      ANALYZE_SPAWN_TIMEOUT + TEST_TIMEOUT_BUFFER,
    );

    it(
      "hint text matches valid command: 'servce' → 'serve'",
      () => {
        const { stderr, code } = runResult(["servce"]);
        expect(code).toBe(1);
        expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
        expect(stderr).toContain("Did you mean");
        expect(stderr).toContain("serve");
      },
      SPAWN_TIMEOUT + TEST_TIMEOUT_BUFFER,
    );

    it(
      "follow-through: hinted 'serve' is a recognized command",
      () => {
        // 'serve' starts a long-running HTTP server; invoke command-specific
        // help to confirm the command is recognized without starting the server.
        const { code, stdout } = runResult(["serve", "--help"], SERVE_HELP_SPAWN_TIMEOUT);
        expect(code).toBe(0);
        expect(stdout).toContain("sourcevision serve");
      },
      SERVE_HELP_SPAWN_TIMEOUT + TEST_TIMEOUT_BUFFER,
    );
  });

  describe("related-command hints after unknown-command errors", () => {
    it(
      "hint: orchestrator-only command 'plan' redirects to ndx plan",
      () => {
        const { stderr, code } = runResult(["plan"]);
        expect(code).toBe(1);
        expect(stderr).toContain("ndx plan");
      },
      SPAWN_TIMEOUT + TEST_TIMEOUT_BUFFER,
    );
  });
});
