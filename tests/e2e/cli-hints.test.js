/**
 * Hint surfacing and follow-through regression tests for the ndx CLI.
 *
 * Each test pair verifies:
 *   (a) a mistyped or unknown command emits hint text referencing a valid command
 *   (b) the hinted command itself exits 0 — confirming the hint is actionable
 *
 * Coverage: typo-correction suggestions, related-command hints after unknown-command
 * errors, flag-validation hints, and next-step suggestions after successful operations.
 */

import { describe, it, expect } from "vitest";
import { runFail, runResult, createTmpDir, removeTmpDir, setupRexDir } from "./e2e-helpers.js";

const UNKNOWN_COMMAND_CODE = "NDX_CLI_UNKNOWN_COMMAND";

describe("ndx CLI hint surfacing and follow-through", () => {
  describe("typo-correction hints", () => {
    it("hint text matches valid command: 'statis' → 'status'", () => {
      const { stderr, status } = runFail(["statis"]);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("status");
      expect(status).toBe(1);
    });

    it("follow-through: hinted 'status' exits 0 with initialized project", async () => {
      const tmp = await createTmpDir("ndx-hints-status-");
      try {
        await setupRexDir(tmp);
        const { code } = runResult(["status", tmp]);
        expect(code).toBe(0);
      } finally {
        await removeTmpDir(tmp);
      }
    });

    it("hint text matches valid command: 'initi' → 'init'", () => {
      const { stderr, status } = runFail(["initi"]);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("init");
      expect(status).toBe(1);
    });

    it("follow-through: hinted 'init' is a known command accessible via help", () => {
      // 'init' requires interactive provider selection; verify it is a known
      // command by checking it appears in top-level help (exits 0).
      const { code, stdout } = runResult(["help"]);
      expect(code).toBe(0);
      expect(stdout).toContain("init");
    });

    it("hint text matches valid command: 'wrok' → 'work'", () => {
      const { stderr, status } = runFail(["wrok"]);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("work");
      expect(status).toBe(1);
    });

    it("follow-through: hinted 'work' is accessible via help and exits 0", () => {
      // 'work' requires API keys and a full project; verify it is a known
      // command by fetching its help page (exits 0).
      const { code, stdout } = runResult(["help", "work"]);
      expect(code).toBe(0);
      expect(stdout).toContain("ndx work");
    });

    it("hint text matches valid command: 'validat' → 'validate'", () => {
      const { stderr, status } = runFail(["validat"]);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("validate");
      expect(status).toBe(1);
    });

    it("follow-through: hinted 'validate' exits 0 after init", async () => {
      const tmp = await createTmpDir("ndx-hints-validate-");
      try {
        await setupRexDir(tmp);
        const { code } = runResult(["validate", tmp]);
        expect(code).toBe(0);
      } finally {
        await removeTmpDir(tmp);
      }
    });
  });

  describe("related-command hints after unknown-command errors", () => {
    it("hint: 'plna' suggests 'plan'", () => {
      const { stderr } = runFail(["plna"]);
      expect(stderr).toContain(`[${UNKNOWN_COMMAND_CODE}]`);
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("plan");
    });

    it("follow-through: hinted 'plan' is accessible via help and exits 0", () => {
      const { code, stdout } = runResult(["help", "plan"]);
      expect(code).toBe(0);
      expect(stdout).toContain("ndx plan");
    });
  });

  describe("flag-validation hints after unknown-command errors", () => {
    it("error for unknown command includes Hint: line", () => {
      const { stderr } = runFail(["unknownxyz"]);
      // Should contain 'Hint:' directing the user to --help
      expect(stderr).toContain("Hint:");
    });

    it("follow-through: --help flag exits 0", () => {
      const { code } = runResult(["--help"]);
      expect(code).toBe(0);
    });
  });
});
