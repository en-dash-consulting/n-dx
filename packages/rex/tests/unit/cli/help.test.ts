import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { showCommandHelp } from "../../../src/cli/help.js";

describe("rex CLI help", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const KNOWN_COMMANDS = [
    "init",
    "status",
    "next",
    "add",
    "update",
    "move",
    "reshape",
    "prune",
    "validate",
    "fix",
    "sync",
    "usage",
    "report",
    "verify",
    "recommend",
    "analyze",
    "import",
    "adapter",
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
        expect(output).toMatch(/Usage:/);

        // Every command should have at least one example
        expect(output).toMatch(/Examples:/);

        // Should start with the command name
        expect(output).toMatch(new RegExp(`^(rex|sourcevision)\\s+${cmd === "import" ? "analyze" : cmd}`));
      });
    }
  });

  describe("command-specific options", () => {
    it("status help includes --all and --format flags", () => {
      showCommandHelp("status");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("--all");
      expect(output).toContain("--format");
    });

    it("add help includes manual and smart modes", () => {
      showCommandHelp("add");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("Manual mode");
      expect(output).toContain("Smart mode");
      expect(output).toContain("--title");
      expect(output).toContain("--file");
    });

    it("analyze help mentions --accept and --guided", () => {
      showCommandHelp("analyze");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("--accept");
      expect(output).toContain("--guided");
    });

    it("sync help includes --push and --pull", () => {
      showCommandHelp("sync");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("--push");
      expect(output).toContain("--pull");
    });
  });
});
