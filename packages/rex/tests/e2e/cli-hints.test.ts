/**
 * Hint surfacing and follow-through regression tests for the rex CLI.
 *
 * Each test pair verifies:
 *   (a) a mistyped command emits hint text referencing a valid rex command
 *   (b) the hinted command itself exits 0 — confirming the hint is actionable
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");
const UNKNOWN_COMMAND_CODE = "NDX_CLI_UNKNOWN_COMMAND";
const TIMEOUT = 10_000;

function runResult(
  args: string[],
): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: TIMEOUT,
      stdio: "pipe",
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.status ?? 1 };
  }
}

describe("rex CLI hint surfacing and follow-through", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-hints-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("typo-correction hints", () => {
    it("hint text matches valid command: 'statis' → 'status'", () => {
      const { stderr, code } = runResult(["statis"]);
      expect(code).toBe(1);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("status");
    });

    it("follow-through: hinted 'status' exits 0 after init", () => {
      const init = runResult(["init", tmpDir]);
      expect(init.code).toBe(0);
      const { code } = runResult(["status", tmpDir]);
      expect(code).toBe(0);
    });

    it("hint text matches valid command: 'valdate' → 'validate'", () => {
      const { stderr, code } = runResult(["valdate"]);
      expect(code).toBe(1);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("validate");
    });

    it("follow-through: hinted 'validate' exits 0 after init", () => {
      const init = runResult(["init", tmpDir]);
      expect(init.code).toBe(0);
      const { code } = runResult(["validate", tmpDir]);
      expect(code).toBe(0);
    });

    it("hint text matches valid command: 'nxt' → 'next'", () => {
      const { stderr, code } = runResult(["nxt"]);
      expect(code).toBe(1);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("next");
    });

    it("follow-through: hinted 'next' does not error with unknown-command after init", () => {
      const init = runResult(["init", tmpDir]);
      expect(init.code).toBe(0);
      const { stderr } = runResult(["next", tmpDir]);
      // 'next' may exit non-0 when no tasks are pending, but it must not be
      // an unknown-command error — the hint was correct.
      expect(stderr).not.toContain(UNKNOWN_COMMAND_CODE);
    });
  });

  describe("related-command hints after unknown-command errors", () => {
    it("hint: orchestrator-only command 'work' redirects to ndx work", () => {
      const { stderr, code } = runResult(["work"]);
      expect(code).toBe(1);
      expect(stderr).toContain("ndx work");
    });
  });
});
