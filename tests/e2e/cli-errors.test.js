import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dirname, "../../cli.js");

function runFail(args, cwd) {
  try {
    execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
      cwd,
    });
    throw new Error("Expected command to fail");
  } catch (err) {
    if (err.message === "Expected command to fail") throw err;
    return { stderr: err.stderr, stdout: err.stdout, status: err.status };
  }
}

describe("n-dx CLI error handling", () => {
  describe("unknown commands", () => {
    it("shows Error and Hint for unknown command", () => {
      const { stderr } = runFail(["foobar"]);
      expect(stderr).toContain("Error: Unknown command: foobar");
      expect(stderr).toContain("Hint:");
    });
  });

  describe("missing directories", () => {
    let tmp;

    it("shows actionable error when .rex/ missing for status", () => {
      tmp = mkdtempSync(join(tmpdir(), "ndx-err-test-"));
      try {
        const { stderr } = runFail(["status", tmp]);
        expect(stderr).toContain("Error:");
        expect(stderr).toContain("Hint:");
        expect(stderr).toContain("ndx init");
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it("shows actionable error when .rex/.hench missing for work", () => {
      tmp = mkdtempSync(join(tmpdir(), "ndx-err-test-"));
      try {
        const { stderr } = runFail(["work", tmp]);
        expect(stderr).toContain("Error:");
        expect(stderr).toContain("Hint:");
        expect(stderr).toContain("ndx init");
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe("error formatting", () => {
    it("never shows stack traces for errors", () => {
      const { stderr } = runFail(["foobar"]);
      expect(stderr).not.toMatch(/at\s+\w+\s+\(/);  // no stack trace lines
      expect(stderr).not.toContain(".js:");
    });
  });
});
