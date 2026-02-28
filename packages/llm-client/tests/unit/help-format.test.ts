import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isColorEnabled,
  resetColorCache,
  bold,
  dim,
  cyan,
  yellow,
  cmd,
  flag,
  sectionHeader,
  requiredParam,
  optionalParam,
  formatHelp,
  formatUsage,
} from "../../src/help-format.js";

import type { HelpDefinition, UsageDefinition } from "../../src/help-format.js";

describe("help-format", () => {
  // Force color off for deterministic test output
  let origNoColor: string | undefined;
  let origForceColor: string | undefined;

  beforeEach(() => {
    origNoColor = process.env.NO_COLOR;
    origForceColor = process.env.FORCE_COLOR;
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    resetColorCache();
  });

  afterEach(() => {
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
    if (origForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = origForceColor;
    resetColorCache();
  });

  describe("color detection", () => {
    it("disables color when NO_COLOR is set", () => {
      process.env.NO_COLOR = "1";
      resetColorCache();
      expect(isColorEnabled()).toBe(false);
    });

    it("FORCE_COLOR overrides NO_COLOR", () => {
      process.env.NO_COLOR = "1";
      process.env.FORCE_COLOR = "1";
      resetColorCache();
      expect(isColorEnabled()).toBe(true);
    });

    it("FORCE_COLOR=0 does not force color on", () => {
      process.env.NO_COLOR = "1";
      process.env.FORCE_COLOR = "0";
      resetColorCache();
      expect(isColorEnabled()).toBe(false);
    });
  });

  describe("ANSI helpers (no-color mode)", () => {
    it("bold returns plain text", () => {
      expect(bold("hello")).toBe("hello");
    });

    it("dim returns plain text", () => {
      expect(dim("hello")).toBe("hello");
    });

    it("cyan returns plain text", () => {
      expect(cyan("hello")).toBe("hello");
    });

    it("yellow returns plain text", () => {
      expect(yellow("hello")).toBe("hello");
    });
  });

  describe("ANSI helpers (forced color)", () => {
    beforeEach(() => {
      delete process.env.NO_COLOR;
      process.env.FORCE_COLOR = "1";
      resetColorCache();
    });

    it("bold wraps in ANSI bold", () => {
      expect(bold("hello")).toBe("\x1b[1mhello\x1b[22m");
    });

    it("dim wraps in ANSI dim", () => {
      expect(dim("hello")).toBe("\x1b[2mhello\x1b[22m");
    });

    it("cyan wraps in ANSI cyan", () => {
      expect(cyan("hello")).toBe("\x1b[36mhello\x1b[39m");
    });

    it("yellow wraps in ANSI yellow", () => {
      expect(yellow("hello")).toBe("\x1b[33mhello\x1b[39m");
    });
  });

  describe("semantic formatters", () => {
    it("cmd formats as cyan (passthrough in no-color)", () => {
      expect(cmd("rex status")).toBe("rex status");
    });

    it("flag formats as yellow (passthrough in no-color)", () => {
      expect(flag("--format")).toBe("--format");
    });

    it("sectionHeader formats as bold (passthrough in no-color)", () => {
      expect(sectionHeader("OPTIONS")).toBe("OPTIONS");
    });

    it("requiredParam wraps in angle brackets", () => {
      expect(requiredParam("id")).toBe("<id>");
    });

    it("optionalParam wraps in square brackets", () => {
      expect(optionalParam("dir")).toBe("[dir]");
    });
  });

  describe("formatHelp", () => {
    const minimalDef: HelpDefinition = {
      tool: "rex",
      command: "init",
      summary: "initialize a .rex/ directory",
      usage: "rex init [dir]",
    };

    it("includes title line with tool, command, and summary", () => {
      const output = formatHelp(minimalDef);
      expect(output).toContain("rex");
      expect(output).toContain("init");
      expect(output).toContain("initialize a .rex/ directory");
    });

    it("includes USAGE section", () => {
      const output = formatHelp(minimalDef);
      expect(output).toContain("USAGE");
      expect(output).toContain("rex init");
    });

    it("includes DESCRIPTION section when provided", () => {
      const def: HelpDefinition = {
        ...minimalDef,
        description: "Sets up .rex/ with config.json and prd.json.",
      };
      const output = formatHelp(def);
      expect(output).toContain("DESCRIPTION");
      expect(output).toContain("Sets up .rex/ with config.json and prd.json.");
    });

    it("omits DESCRIPTION section when not provided", () => {
      const output = formatHelp(minimalDef);
      expect(output).not.toContain("DESCRIPTION");
    });

    it("includes OPTIONS section with flags and descriptions", () => {
      const def: HelpDefinition = {
        ...minimalDef,
        options: [
          { flag: "--project=<name>", description: "Project name" },
          { flag: "--analyze", description: "Run analysis after init" },
        ],
      };
      const output = formatHelp(def);
      expect(output).toContain("OPTIONS");
      expect(output).toContain("--project=<name>");
      expect(output).toContain("Project name");
      expect(output).toContain("--analyze");
    });

    it("marks required options with asterisk", () => {
      const def: HelpDefinition = {
        ...minimalDef,
        options: [
          { flag: "--title=\"...\"", description: "Item title", required: true },
          { flag: "--parent=<id>", description: "Parent ID" },
        ],
      };
      const output = formatHelp(def);
      expect(output).toContain("* = required");
    });

    it("does not show required legend when no required options", () => {
      const def: HelpDefinition = {
        ...minimalDef,
        options: [
          { flag: "--format=json", description: "Output format" },
        ],
      };
      const output = formatHelp(def);
      expect(output).not.toContain("* = required");
    });

    it("includes EXAMPLES section", () => {
      const def: HelpDefinition = {
        ...minimalDef,
        examples: [
          { command: "rex init", description: "Initialize in current directory" },
          { command: "rex init ./my-project", description: "Initialize in a specific directory" },
        ],
      };
      const output = formatHelp(def);
      expect(output).toContain("EXAMPLES");
      expect(output).toContain("rex init");
      expect(output).toContain("Initialize in current directory");
    });

    it("includes 'See also' line when related commands are provided", () => {
      const def: HelpDefinition = {
        ...minimalDef,
        related: ["status", "analyze"],
      };
      const output = formatHelp(def);
      expect(output).toContain("See also:");
      expect(output).toContain("rex status");
      expect(output).toContain("rex analyze");
    });

    it("omits 'See also' when no related commands", () => {
      const output = formatHelp(minimalDef);
      expect(output).not.toContain("See also:");
    });

    it("handles multiple usage lines", () => {
      const def: HelpDefinition = {
        ...minimalDef,
        usage: [
          "rex add <level> --title=\"...\" [options] [dir]",
          "rex add \"<description>\" [dir]",
        ],
      };
      const output = formatHelp(def);
      expect(output).toContain("rex add");
      // Both usage lines should be present
      const usageLines = output.split("\n").filter((l) => l.includes("rex add"));
      expect(usageLines.length).toBeGreaterThanOrEqual(2);
    });

    it("includes custom sections", () => {
      const def: HelpDefinition = {
        ...minimalDef,
        sections: [
          { title: "Phases", content: "1. Inventory    File listing\n2. Imports      Dependency graph" },
        ],
      };
      const output = formatHelp(def);
      expect(output).toContain("PHASES");
      expect(output).toContain("Inventory");
      expect(output).toContain("Imports");
    });

    it("full help has consistent section ordering", () => {
      const def: HelpDefinition = {
        tool: "rex",
        command: "analyze",
        summary: "build PRD from project analysis",
        description: "Scans the codebase and generates proposals.",
        usage: "rex analyze [options] [dir]",
        sections: [
          { title: "Phases", content: "1. Scan\n2. Propose" },
        ],
        options: [
          { flag: "--accept", description: "Accept all proposals" },
        ],
        examples: [
          { command: "rex analyze", description: "Interactive review" },
        ],
        related: ["add", "recommend"],
      };
      const output = formatHelp(def);

      // Verify section ordering
      const descIdx = output.indexOf("DESCRIPTION");
      const usageIdx = output.indexOf("USAGE");
      const phasesIdx = output.indexOf("PHASES");
      const optIdx = output.indexOf("OPTIONS");
      const exIdx = output.indexOf("EXAMPLES");
      const seeAlsoIdx = output.indexOf("See also:");

      expect(descIdx).toBeGreaterThan(-1);
      expect(usageIdx).toBeGreaterThan(descIdx);
      expect(phasesIdx).toBeGreaterThan(usageIdx);
      expect(optIdx).toBeGreaterThan(phasesIdx);
      expect(exIdx).toBeGreaterThan(optIdx);
      expect(seeAlsoIdx).toBeGreaterThan(exIdx);
    });
  });

  describe("formatUsage", () => {
    const minimalUsage: UsageDefinition = {
      title: "rex v0.1.0 — PRD management",
      usage: "rex <command> [options] [dir]",
      sections: [
        {
          title: "Commands",
          items: [
            { name: "init [dir]", description: "Initialize .rex/ directory" },
            { name: "status [dir]", description: "Show PRD tree" },
          ],
        },
      ],
    };

    it("includes title", () => {
      const output = formatUsage(minimalUsage);
      expect(output).toContain("rex v0.1.0");
    });

    it("includes USAGE section", () => {
      const output = formatUsage(minimalUsage);
      expect(output).toContain("USAGE");
      expect(output).toContain("rex");
    });

    it("includes command sections", () => {
      const output = formatUsage(minimalUsage);
      expect(output).toContain("COMMANDS");
      expect(output).toContain("init");
      expect(output).toContain("status");
    });

    it("includes global options when provided", () => {
      const def: UsageDefinition = {
        ...minimalUsage,
        options: [
          { flag: "--quiet, -q", description: "Suppress informational output" },
        ],
      };
      const output = formatUsage(def);
      expect(output).toContain("OPTIONS");
      expect(output).toContain("--quiet");
    });

    it("includes footer when provided", () => {
      const def: UsageDefinition = {
        ...minimalUsage,
        footer: [
          "Run 'rex <command> --help' for detailed help.",
        ],
      };
      const output = formatUsage(def);
      expect(output).toContain("Run 'rex <command> --help'");
    });

    it("handles multiple sections", () => {
      const def: UsageDefinition = {
        ...minimalUsage,
        sections: [
          {
            title: "Orchestration",
            items: [
              { name: "init", description: "Initialize all tools" },
            ],
          },
          {
            title: "Tools",
            items: [
              { name: "rex", description: "PRD management" },
            ],
          },
        ],
      };
      const output = formatUsage(def);
      expect(output).toContain("ORCHESTRATION");
      expect(output).toContain("TOOLS");
    });
  });

  describe("color integration (forced color)", () => {
    beforeEach(() => {
      delete process.env.NO_COLOR;
      process.env.FORCE_COLOR = "1";
      resetColorCache();
    });

    it("formatHelp applies cyan to commands in title", () => {
      const def: HelpDefinition = {
        tool: "rex",
        command: "init",
        summary: "initialize",
        usage: "rex init [dir]",
      };
      const output = formatHelp(def);
      // Cyan escape for "rex"
      expect(output).toContain("\x1b[36mrex\x1b[39m");
      // Cyan escape for "init"
      expect(output).toContain("\x1b[36minit\x1b[39m");
    });

    it("formatHelp applies bold to section headers", () => {
      const def: HelpDefinition = {
        tool: "rex",
        command: "init",
        summary: "initialize",
        usage: "rex init [dir]",
        options: [{ flag: "--help", description: "Show help" }],
      };
      const output = formatHelp(def);
      expect(output).toContain("\x1b[1mUSAGE\x1b[22m");
      expect(output).toContain("\x1b[1mOPTIONS\x1b[22m");
    });

    it("formatHelp applies yellow to flags", () => {
      const def: HelpDefinition = {
        tool: "rex",
        command: "status",
        summary: "show status",
        usage: "rex status [dir]",
        options: [{ flag: "--all", description: "Show all" }],
      };
      const output = formatHelp(def);
      expect(output).toContain("\x1b[33m--all\x1b[39m");
    });

    it("formatHelp applies dim to example descriptions", () => {
      const def: HelpDefinition = {
        tool: "rex",
        command: "init",
        summary: "initialize",
        usage: "rex init [dir]",
        examples: [{ command: "rex init", description: "Initialize here" }],
      };
      const output = formatHelp(def);
      expect(output).toContain("\x1b[2mInitialize here\x1b[22m");
    });
  });
});
