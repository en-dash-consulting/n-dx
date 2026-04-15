/**
 * Hint surfacing and follow-through regression tests for the hench CLI.
 *
 * Each test pair verifies:
 *   (a) a mistyped command emits hint text referencing a valid hench command
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

describe("hench CLI hint surfacing and follow-through", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-hints-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("typo-correction hints", () => {
    it("hint text matches valid command: 'ini' → 'init'", () => {
      const { stderr, code } = runResult(["ini"]);
      expect(code).toBe(1);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("init");
    });

    it("follow-through: hinted 'init' exits 0 in empty directory", () => {
      const { code } = runResult(["init", tmpDir]);
      expect(code).toBe(0);
    });

    it("hint text matches valid command: 'statos' → 'status'", () => {
      const { stderr, code } = runResult(["statos"]);
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

    it("hint text matches valid command: 'runn' → 'run'", () => {
      const { stderr, code } = runResult(["runn"]);
      expect(code).toBe(1);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("run");
    });

    it("follow-through: hinted 'run' does not error with unknown-command", () => {
      // 'run' requires rex + API setup to execute fully; verify it is a
      // recognized command by checking the error is not unknown-command.
      const init = runResult(["init", tmpDir]);
      expect(init.code).toBe(0);
      const { stderr } = runResult(["run", tmpDir]);
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
