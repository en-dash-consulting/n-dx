import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { showCommandHelp } from "../../../src/cli/help.js";

describe("hench CLI help", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const KNOWN_COMMANDS = [
    "init",
    "run",
    "status",
    "show",
    "config",
    "template",
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

        // Should start with "hench <command>"
        expect(output).toMatch(new RegExp(`^hench\\s+${cmd}`));
      });
    }
  });

  describe("related commands", () => {
    it("includes 'See also' for commands with related commands", () => {
      logSpy.mockClear();
      showCommandHelp("run");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("See also:");
      expect(output).toContain("hench status");
    });
  });

  describe("command-specific options", () => {
    it("run help includes --task, --epic, and --dry-run flags", () => {
      showCommandHelp("run");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("--task");
      expect(output).toContain("--epic");
      expect(output).toContain("--dry-run");
      expect(output).toContain("--loop");
      expect(output).toContain("--auto");
    });

    it("status help includes --last and --format flags", () => {
      showCommandHelp("status");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("--last");
      expect(output).toContain("--format");
    });

    it("config help shows all three usage modes", () => {
      showCommandHelp("config");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("--interactive");
      expect(output).toContain("Display all current settings");
    });

    it("template help includes subcommands", () => {
      showCommandHelp("template");
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("list");
      expect(output).toContain("show");
      expect(output).toContain("apply");
      expect(output).toContain("save");
      expect(output).toContain("delete");
    });
  });
});
