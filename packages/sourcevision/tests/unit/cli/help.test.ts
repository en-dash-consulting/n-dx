import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { showCommandHelp, usage } from "../../../src/cli/help.js";

describe("sourcevision CLI help", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const KNOWN_COMMANDS = [
    "init",
    "analyze",
    "serve",
    "validate",
    "reset",
    "export-pdf",
    "pr-markdown",
    "git-credential-helper",
    "mcp",
  ];

  it("returns true for all known commands", () => {
    for (const cmd of KNOWN_COMMANDS) {
      logSpy.mockClear();
      expect(showCommandHelp(cmd)).toBe(true);
      expect(logSpy).toHaveBeenCalledOnce();
    }
  });

  it("returns false for unknown commands", () => {
    expect(showCommandHelp("nonexistent")).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });

  describe("help content structure", () => {
    for (const cmd of KNOWN_COMMANDS) {
      it(`${cmd}: includes usage line and examples`, () => {
        logSpy.mockClear();
        showCommandHelp(cmd);
        const output = logSpy.mock.calls[0][0] as string;

        // Every command help should include a usage line
        expect(output).toMatch(/USAGE/);

        // Every command should have at least one example
        expect(output).toMatch(/EXAMPLES/);

        // Should start with "sourcevision <command>"
        expect(output).toMatch(new RegExp(`^sourcevision\\s+${cmd}`));
      });
    }
  });

  describe("related commands", () => {
    it("includes 'See also' for commands with related commands", () => {
      logSpy.mockClear();
      showCommandHelp("analyze");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("See also:");
      expect(output).toContain("sourcevision validate");
    });

    it("does not include 'See also' for mcp (no related commands)", () => {
      logSpy.mockClear();
      showCommandHelp("mcp");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).not.toContain("See also:");
    });
  });

  describe("usage()", () => {
    it("prints top-level usage text to console.log", () => {
      logSpy.mockClear();
      usage();
      expect(logSpy).toHaveBeenCalledOnce();
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/sourcevision/i);
      expect(output).toMatch(/analyze/);
    });
  });

  describe("command-specific options", () => {
    it("analyze help includes --phase and --fast flags", () => {
      showCommandHelp("analyze");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("--phase");
      expect(output).toContain("--fast");
      expect(output).toContain("--full");
    });

    it("serve help includes --port flag", () => {
      showCommandHelp("serve");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("--port");
    });

    it("export-pdf help includes --output flag", () => {
      showCommandHelp("export-pdf");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("--output");
    });

    it("pr-markdown help includes output location", () => {
      showCommandHelp("pr-markdown");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain(".sourcevision/pr-markdown.md");
    });
  });
});
