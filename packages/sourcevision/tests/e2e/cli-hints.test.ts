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

function runResult(
  args: string[],
  timeout = 10_000,
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
    it("hint text matches valid command: 'valdate' → 'validate'", () => {
      const { stderr, code } = runResult(["valdate"]);
      expect(code).toBe(1);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("validate");
    });

    it("follow-through: hinted 'validate' exits 0 after init", () => {
      // init creates manifest.json; validate checks all data files and skips
      // missing ones, so it exits 0 with only manifest present.
      const init = runResult(["init", tmpDir]);
      expect(init.code).toBe(0);
      const { code } = runResult(["validate", tmpDir]);
      expect(code).toBe(0);
    }, 15_000);

    it(
      "hint text matches valid command: 'analyzee' → 'analyze'",
      async () => {
        const { stderr, code } = runResult(["analyzee"]);
        expect(code).toBe(1);
        expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
        expect(stderr).toContain("Did you mean");
        expect(stderr).toContain("analyze");
      },
    );

    it(
      "follow-through: hinted 'analyze' exits 0 on small fixture",
      async () => {
        // Copy fixture to avoid writing .sourcevision/ into the source tree.
        await cp(SMALL_FIXTURE, tmpDir, { recursive: true });
        const { code } = runResult(["analyze", tmpDir, "--fast"], 30_000);
        expect(code).toBe(0);
      },
      30_000,
    );

    it("hint text matches valid command: 'servce' → 'serve'", () => {
      const { stderr, code } = runResult(["servce"]);
      expect(code).toBe(1);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("serve");
    });

    it("follow-through: hinted 'serve' is a recognized command", () => {
      // 'serve' starts a long-running HTTP server; invoke it with --help to
      // confirm it is a known command without starting the server.
      const { code, stdout } = runResult(["--help"]);
      expect(code).toBe(0);
      expect(stdout).toContain("serve");
    });
  });

  describe("related-command hints after unknown-command errors", () => {
    it("hint: orchestrator-only command 'plan' redirects to ndx plan", () => {
      const { stderr, code } = runResult(["plan"]);
      expect(code).toBe(1);
      expect(stderr).toContain("ndx plan");
    }, 15_000);
  });
});
