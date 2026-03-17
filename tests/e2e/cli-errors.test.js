import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run, runFail } from "./e2e-helpers.js";

describe("n-dx CLI error handling", () => {
  describe("unknown commands", () => {
    it("shows Error and Hint for unknown command", () => {
      const { stderr } = runFail(["foobar"]);
      expect(stderr).toContain("Error: Unknown command: foobar");
      expect(stderr).toContain("Hint:");
    });

    it("suggests similar command for typos", () => {
      const { stderr } = runFail(["statis"]);
      expect(stderr).toContain("Error: Unknown command: statis");
      expect(stderr).toContain("Did you mean");
      expect(stderr).toContain("status");
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

describe("n-dx help navigation", () => {
  describe("ndx help (no args)", () => {
    it("shows main help with navigation hints", () => {
      const output = run(["help"]);
      expect(output).toContain("n-dx — AI-powered development toolkit");
      expect(output).toContain("ndx help <keyword>");
      expect(output).toContain("ndx <command> --help");
    });
  });

  describe("ndx help <tool>", () => {
    it("shows rex subcommands with navigation hints", () => {
      const output = run(["help", "rex"]);
      expect(output).toContain("Rex — available commands");
      expect(output).toContain("init");
      expect(output).toContain("status");
      expect(output).toContain("validate");
      expect(output).toContain("rex <command> --help");
    });

    it("shows hench subcommands with navigation hints", () => {
      const output = run(["help", "hench"]);
      expect(output).toContain("Hench — available commands");
      expect(output).toContain("run");
      expect(output).toContain("config");
    });

    it("shows sourcevision subcommands with navigation hints", () => {
      const output = run(["help", "sourcevision"]);
      expect(output).toContain("SourceVision — available commands");
      expect(output).toContain("analyze");
    });

    it("handles sv alias", () => {
      const output = run(["help", "sv"]);
      expect(output).toContain("SourceVision — available commands");
    });
  });

  describe("ndx help <command>", () => {
    it("shows detailed help for orchestration commands", () => {
      const output = run(["help", "plan"]);
      expect(output).toContain("ndx plan");
      expect(output).toContain("USAGE");
      expect(output).toContain("EXAMPLES");
      expect(output).toContain("See also:");
    });
  });

  describe("ndx help <keyword>", () => {
    it("searches for commands by keyword", () => {
      const output = run(["help", "PRD"]);
      expect(output).toContain("Search results for 'PRD'");
      expect(output).toContain("ndx");
    });

    it("shows 'no results' for unmatched keyword", () => {
      const output = run(["help", "xyznonexistent"]);
      expect(output).toContain("No commands found");
    });

    it("finds commands by function keywords", () => {
      const output = run(["help", "autonomous"]);
      expect(output).toContain("Search results for 'autonomous'");
    });
  });
});
